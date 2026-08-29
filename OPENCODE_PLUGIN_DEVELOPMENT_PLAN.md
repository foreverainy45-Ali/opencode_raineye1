# OpenCode RainEye 插件开发方案

> 文档状态：0.3.0 已实现并通过构建、单测、扩展激活、VSIX 与 OpenCode 1.18.25 API 冒烟验证
> 生成日期：2026-08-29  
> 目标平台：VS Code，首发环境为 Windows 11 + OpenCode CLI 1.18.25  
> 参考基线：`sst-dev.opencode-0.0.13.vsix`、`界面页.png`、本目录既有需求/审计/计划文档、OpenCode 官方 Server/SDK 文档

已确认决策（2026-08-29）：

- 主界面采用原生 View Container + 最小 WebviewView。
- Craft 采用执行前 Permission 审批，执行完成后展示 Diff。
- 连接时先自动发现；未发现时允许新建 managed server，或手动连接“本机 + 端口”“URL + 端口”。
- Skill 与 MCP 完全采用 OpenCode 1.18.25 官方配置 schema 和进程实现；RainEye 只提供配置 UI、调用官方 API 和展示官方状态。

0.3.0 增量：设置页已支持项目/全局 Skill、`skills.paths` / `skills.urls`、OpenAI-compatible 自定义 Provider/Model；Composer 已支持 `@` 工作区文件补全。仓库同时包含可实际连接的 Python MCP 与调用 Python 脚本的 Skill 测试样例。

## 1. 结论摘要

本项目建议从当前空骨架重新搭建，不继续假设旧版项目源码仍存在。推荐方案是：

1. 使用 **VS Code 原生 View Container + 最小化 WebviewView** 实现 CodeBuddy 风格的侧边栏聊天页。
2. Extension Host 负责 OpenCode 进程、SDK、文件、Secret、Workspace Trust 和 VS Code 命令；Webview 只负责渲染和交互，不能直接访问 OpenCode Server 或文件系统。
3. 对 OpenCode 使用 **headless `opencode serve` + 官方 SDK/HTTP API**。官方 VSIX 的 Terminal 启动与 `/tui/append-prompt` 只作为进程启动、端口和文件引用方式的参考，不作为新聊天 UI 的主协议。
4. OpenCode Session、Message、Provider、Model、Agent、Skill 和 MCP 是事实源；插件只缓存当前选择和界面状态，不维护第二套会话数据库。
5. `Plan` 显示名映射 OpenCode `plan` agent；`Craft` 显示名映射 OpenCode `build` agent，同一对话切换模式时默认复用同一个 Session。
6. 第一版优先采用 OpenCode 原生 Permission 的“执行前审批”；“执行后逐文件接受/拒绝”需要隔离工作区或可靠快照，不能伪装成已安全实现。

## 2. 已核验基线

### 2.1 当前目录

- `opencode-raineye/` 下只有 `media/`、`src/` 和若干空子目录，没有 `package.json`、源码、构建配置或测试。
- 根目录不是 Git 仓库，不能把既有方案中“已有可运行 VSIX/已有 React 项目”视为当前事实。
- `PLAN_v2.md`、`PLAN_v3.md`、`PLAN_v4.md` 和审计文档仍有参考价值，尤其是事件适配、Workspace Trust、Windows CLI、Session 复用、安全边界和测试建议。
- 旧文档中描述的 `src/opencode/*`、`webview/*` 等代码当前并不存在；本方案将它们当作设计经验，而不是增量修改清单。

### 2.2 官方 VSIX 0.0.13 的真实行为

已解包并核验 `vsix_extracted/extension/dist/extension.js`：

- 扩展没有侧边栏聊天 UI，也没有 Webview。
- `Ctrl+Esc` 查找名称为 `opencode` 的 VS Code Terminal；找到则聚焦，找不到则新建。
- `Ctrl+Shift+Esc` 总是新建 Terminal。
- 新建时随机选择 `16384..65535` 端口，设置：
  - `_EXTENSION_OPENCODE_PORT=<port>`
  - `OPENCODE_CALLER=vscode`
- 在 Terminal 中发送 `opencode --port <port>`，由 TUI 自己启动 Server。
- 当前编辑器引用生成 `@相对路径#Lx-Ly`；如果知道扩展端口，则调用 `POST /tui/append-prompt`，否则直接向 Terminal 输入文本。

本项目应继承的思想：

- CLI 是运行依赖，扩展不重新实现 Agent Runtime。
- 使用 loopback Server 与 OpenCode 通信。
- 文件引用使用工作区相对路径和行号。
- 进程/Terminal 已存在时优先复用，扩展创建的实例要能被明确识别。

本项目不能直接照抄的部分：

- Terminal 无法实现参考图中的历史会话、设置、结构化消息、图片附件、模型/Skill 选择和可拉伸 Composer。
- `/tui/append-prompt` 只是在控制 TUI 输入框，不是完整 Session 客户端协议。
- 随机端口不做占用校验，存在竞态。
- 通过 `terminal.sendText("opencode ...")` 会受用户 Shell、PowerShell 执行策略、alias/profile 影响。
- 官方代码仅能可靠复用自己创建并知道端口的 Terminal，不能自动连接任意随机端口的外部 TUI。

### 2.3 本机 OpenCode 环境

- npm 全局包 `opencode-ai` 版本为 `1.18.25`。
- PATH 同时提供 `opencode.ps1`、`opencode.cmd` 和无扩展名入口。
- PowerShell 当前会优先解析 `opencode.ps1`，但执行策略禁止脚本执行。
- 直接运行 `opencode.cmd` 当前又因 `C:\Users\Foreverain\.config\opencode` 路径冲突报 `EEXIST`。
- 核验时没有运行中的 OpenCode 进程。

因此第一阶段必须先完成 CLI 入口解析和最小 Server 启动合同测试。Windows 上优先直接执行包内 `opencode.exe`，其次使用 `.cmd`；不能依赖 Shell 自动解析。

### 2.4 OpenCode 1.18.x 可用能力

方案以安装版本发布的 `/doc` OpenAPI 与锁定版 SDK 类型为最终合同。官方文档当前明确提供：

- `opencode serve --hostname 127.0.0.1 --port <port>`。
- `GET /global/health` 获取健康状态和版本。
- `GET /global/event` 或 `GET /event` 订阅 SSE。
- Session 的 list/create/update/delete/status/messages/promptAsync/abort/diff/revert。
- Provider/Model、Agent、Config、Auth、MCP 状态与动态新增等 API。
- Server Password Basic Auth。
- Skill 由 OpenCode 原生 `skill` tool 按需加载。

官方入口：

- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [OpenCode Agent Skills](https://opencode.ai/docs/skills/)
- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/)

文档站最近仍在变化，因此实现时必须以本机 `1.18.25` 的 `/doc` 和 SDK 导出类型生成脱敏 fixture，不能用网页示例替代合同测试。

## 3. UI 技术选择与冲突说明

### 3.1 方案比较

| 方案 | Webview | 接近官方 0.0.13 | 满足参考图 | 结论 |
| --- | --- | --- | --- | --- |
| 仅 Terminal/TUI | 否 | 最高 | 否 | 只能作为兼容入口 |
| TreeView + QuickPick + Terminal | 否 | 较高 | 低；输入、附件、卡片被拆散 | 不采用为主界面 |
| VS Code Chat Participant | 否/由 VS Code 托管 | 中 | 不能拥有目标布局和底栏控件 | 可做后续集成 |
| 原生 View Container + 最小 WebviewView | 是 | 进程层高、界面层自定义 | 高 | **推荐** |

### 3.2 为什么不能完全不用 Webview

VS Code 稳定的原生 View API 主要提供 TreeView、Welcome View、命令和 Terminal。它们不能组合出以下交互：

- 输入区上边缘拖拽改变高度。
- 附件缩略图和文件 Chip 挂在输入框上方。
- 同一底栏中的 Craft/Plan、模型、Skill 和发送/停止按钮。
- Markdown、代码、Tool、Permission、Question、Diff 等多种结构化消息卡片。
- 在窄侧边栏内完成历史、聊天、设置的连续路由。

因此“完全不用 Webview”和“做成参考图页面”是冲突目标。推荐把 Webview 限制为纯 UI 沙箱，其余能力仍采用官方扩展式的 Extension Host/CLI 架构。

### 3.3 Webview 边界

Webview 允许：

- 显示会话、消息、附件元数据和连接状态。
- 收集普通 Prompt、选择项和按钮事件。
- 在内存中暂存发送前的图片预览。

Webview 禁止：

- 直接 `fetch` OpenCode Server。
- 读取任意本地文件或打开任意路径。
- 持久化 API Key、Server Password、完整 base64 图片。
- 拼接/执行 Shell 命令。
- 直接写 OpenCode 配置文件。

所有 Webview 消息使用带版本号的判别联合类型，并在 Extension Host 运行时校验。CSP 仅允许 nonce script、自身样式和经过 `asWebviewUri` 转换的本地资源。

## 4. 总体架构

```text
VS Code View Container
  -> Chat WebviewView（纯 UI）
  -> typed message bridge
Extension Host
  -> ChatViewProvider
  -> SessionController
  -> EventStreamManager + EventAdapter
  -> OpenCodeClientAdapter
  -> ConnectionManager
       -> Existing Server
       -> Managed `opencode serve`
  -> Workspace/Attachment/Config/Secret/Policy services
OpenCode Server
  -> Session / Message / Agent / Provider / Model
  -> Permission / Question / Diff
  -> Skill / MCP / Config / Auth
```

### 4.1 状态事实源

| 数据 | 唯一事实源 | 插件缓存 |
| --- | --- | --- |
| Session 与消息 | OpenCode Server | 当前 Session ID、已渲染索引 |
| Provider/Model | OpenCode Server Config/Provider API | 每工作区最近选择 |
| Agent/模式 | OpenCode Agent API | UI 的 `Plan -> plan`、`Craft -> build` 映射 |
| Skill | OpenCode 实际发现结果 | 当前 Prompt 显式选择 |
| MCP 配置/状态 | OpenCode Config + MCP API | 设置页临时表单 |
| Managed Server 凭据 | VS Code SecretStorage | 内存中的认证 header |
| Composer 高度/草稿 | Webview state + workspaceState | 不包含 base64/Secret |

### 4.2 关键内部服务

- `ConnectionManager`：发现、验证、选择、启动、重连和关闭 Server。
- `CliLocator`：跨平台解析用户配置、`.exe`、`.cmd/.bat` 和 PATH。
- `ManagedServer`：分配端口、启动 `serve`、健康检查、日志脱敏和生命周期。
- `OpenCodeClientAdapter`：屏蔽 SDK 版本差异，对外提供稳定接口。
- `EventStreamManager`：一台 Server 一条 SSE、ready、重连、释放、背压。
- `OpenCodeEventAdapter`：运行时校验、旧/新事件兼容、去重和标准化。
- `SessionController`：请求状态机、Session 切换、消息对账、取消和恢复。
- `PolicyService`：Workspace Trust、Plan/Craft 规则、路径边界和 Permission。
- `AttachmentService`：`@` 文件、编辑器选区、图片读取/压缩/预算。
- `OpenCodeConfigService`：Provider/MCP/Skill 配置的读、合并、校验和刷新。

## 5. OpenCode 进程发现与连接

### 5.1 “发现进程”的准确语义

插件真正需要发现的是“可验证的 OpenCode Server 端点”，而不是只找到一个名为 `opencode.exe` 的 OS 进程。仅有 PID 时通常不知道随机端口、认证信息、所属目录和 API 版本，不能安全连接。

自动收集候选端点，按以下优先级验证：

1. 用户在设置中明确配置的 `serverUrl`。
2. 本扩展在 `workspaceState` 保存的 managed server 元数据。
3. 用户最近成功连接的端点元数据。
4. VS Code Terminal 的 `creationOptions.env._EXTENSION_OPENCODE_PORT`，用于兼容官方扩展创建的 Terminal。
5. mDNS（显式启用时），过滤 OpenCode 官方的 `_http._tcp.local`、`opencode-${port}` 广播。
6. Windows `netstat -ano -p tcp` 返回的 loopback/wildcard `LISTENING` 端口；只把它们作为候选，不依赖进程名或 PID 权限。
7. `http://127.0.0.1:4096`（或设置中的默认端口）。

每个候选都必须通过：

- `/global/health`：确认确实是 OpenCode，并取得版本。
- `/path`：确认目标 directory/worktree 与当前工作区匹配，或明确提示跨目录。
- 认证探测：不能把 401 误报为“不是 OpenCode”。
- 版本策略：同 major/已验证 minor 可连接，未验证版本进入兼容模式并提示。

不扫描全部 65535 个端口，也不用进程名猜端口。候选健康检查采用有限并发（24 路）和 450ms 单请求超时；健康检查成功后再请求 `/path`。工作区精确匹配优先于来源优先级；同级有多个实例时必须由用户选择。HTTP 401 单独进入“已发现、需要密码”状态。mDNS 默认关闭，避免误连局域网服务。自动发现没有结果时不直接判定失败，而是进入“新建实例/手动连接”选择。

连接成功后持久化 `{ endpoint, pid, workspacePath, version }`，下次启动先重新验证再复用。托管实例仍使用动态空闲端口；在释放临时监听 socket 与 OpenCode 实际 bind 之间若出现 `EADDRINUSE`，自动重新选择端口，最多尝试 4 次。

手动连接提供两种输入模式：

- `本机 + 端口`：Host 固定为 `127.0.0.1`，用户输入 `1..65535` 端口。
- `URL + 端口`：用户输入 `http://` 或 `https://` URL；端口可以单独填写，也可以包含在 URL 中，但两处同时存在且冲突时禁止连接。

手动地址仍必须通过 health、认证、版本和 workspace path 校验。连接成功后保存为最近使用的端点；保存 Server Password 时使用 SecretStorage，不写入普通 VS Code 配置。

### 5.2 用户交互流程

```text
打开 RainEye
  -> 收集并健康验证候选
  -> 有候选：提示“发现 OpenCode Server”
       [连接] [启动新实例] [查看详情]
  -> 无候选：显示连接选择
       [新建实例] [手动连接]
       -> 新建实例：检查 Workspace Trust 和 CLI，启动 managed server
       -> 手动连接：选择“本机 + 端口”或“URL + 端口”
       -> 失败时保留输入并显示可操作诊断
```

如果发现多个端点，使用 QuickPick 显示 URL、版本、目录、来源和“由本扩展管理/外部”标记，不自动猜一个。

### 5.3 Managed Server 启动

- 默认命令：`opencode serve --hostname 127.0.0.1 --port <allocatedPort>`。
- 使用 Extension Host 的 `child_process.spawn` 参数数组，默认 `shell: false`。
- Windows 优先执行实际 `opencode.exe`；若只能使用 `.cmd/.bat`，固定走 `cmd.exe /d /s /c` 并严格转义。
- 先申请可用 loopback 端口；若发生占用竞态，最多重新分配并重试两次。
- 设置 `OPENCODE_CALLER=vscode`。
- 如果 1.18.25 合同测试确认支持，生成随机 `OPENCODE_SERVER_PASSWORD`，存入 SecretStorage，并只在 Extension Host 组装 Basic Auth。
- stdout/stderr 写入 `OpenCode RainEye` Output Channel，但过滤 Prompt、Authorization、Key、图片和文件正文。
- 启动后 10 秒内轮询 health；错误区分未安装、入口无效、执行策略、配置损坏、端口占用和 Server 启动超时。
- View 隐藏不停止 Server；扩展正常 deactivate 时只终止自己拥有的子进程。外部 Server 永远不由插件停止。

### 5.4 Remote 与多根工作区

- CLI 和 Server 应运行在 Extension Host 所在环境；Remote SSH/WSL/Dev Container 下不能误启宿主 Windows CLI。
- MVP 每个 VS Code Window 只维护一个活动 OpenCode directory；多根工作区使用顶部目录选择器或跟随当前编辑器切换。
- 多工作区同时生成、远端 mDNS 和跨设备 Server 不进入首个 VSIX 验收范围。

## 6. Session、事件和请求状态机

### 6.1 Session 策略

- “新增对话”先进入本地空白态，首条消息发送时再创建 Server Session，避免产生大量空 Session。
- “历史对话”来自 `session.list`，按当前 directory/worktree 过滤并按更新时间倒序。
- 切换历史时从 `session.messages` 恢复完整结构化消息。
- 当前 Session ID 存入 `workspaceState`；Reload Window 后重新从 Server 对账。
- Plan/Craft 切换不新建 Session，以保留上下文。
- 删除 Session 使用原生 API，必须二次确认；不实现插件侧软删除假状态。

### 6.2 事件流

- 连接成功后先建立 SSE，再允许发送 Prompt。
- 第一条 `server.connected` 可能没有 `directory`，只作为 ready 握手，不能触发路径解析异常。
- 原始事件先经过运行时 schema，再按 `directory/sessionID/messageID/partID` 分发。
- 支持 `message.part.delta` 文本增量和 `message.part.updated` 快照；未知事件记录类型后忽略，不能终止事件循环。
- EventAdapter 输出稳定内部事件：`text`、`reasoning`、`tool`、`step`、`file`、`patch`、`permission`、`question`、`error`、`status`。
- SSE 断开时指数退避重连；重连期间通过 `session.status + session.messages` 恢复，不单纯依赖事件不丢失。

### 6.3 请求状态机

```text
idle -> submitting -> running
running -> awaiting_permission | awaiting_question | reconnecting
running -> completed | failed | cancelled | timed_out
```

- 每次发送生成 `requestId + messageId + sessionId`。
- 使用 `promptAsync`，避免 HTTP 长请求和 SSE 双重流式响应。
- `session.idle` 后做一次 messages/diff 对账，再进入 completed。
- Send 在运行中变为 Stop；Stop 调用 `session.abort`，并等待明确终态。
- 任何 API 错误、事件错误、视图销毁和超时都必须清理 loading。
- 每个 Session 同时只允许一个 active request；其他 Session 的事件不能追加到当前页面。

## 7. 界面信息架构

### 7.1 主页面

```text
Header
  当前会话标题
  [+ 新增] [历史] [设置] [更多]

Message viewport / Welcome state
  用户消息
  文本/推理/工具/问题/权限/Diff/错误卡片

Composer
  顶部拖拽手柄
  Attachment shelf：@文件 Chip + 图片缩略图
  Quick actions：@文件 / 图片 / 可扩展入口
  Textarea
  Bottom bar：Craft|Plan / Model / Skill / Send|Stop
```

### 7.2 Header

- 左侧标题单行省略，右侧按钮固定尺寸。
- `+`：新增对话。
- 历史：打开同宽覆盖页，含搜索、切换、重命名和删除。
- 设置：打开同宽覆盖页，顶部返回按钮。
- 更多：诊断、打开 Output、重新连接、在 Terminal 打开官方 TUI。

“在 Terminal 打开 TUI”保留官方扩展体验，作为故障排查和高级命令入口，但不替代插件聊天页。

### 7.3 Welcome state

- 保留参考图的中心欢迎语和简短能力说明，但使用 RainEye/OpenCode 自身视觉，不复制 CodeBuddy 品牌素材。
- 连接未完成时显示真实连接阶段和操作按钮，不显示假聊天空页。
- 未信任工作区展示只读说明和“管理工作区信任”入口。

### 7.4 Composer 与拖拽

- 页面根布局使用纵向 Grid/Flex，不使用 fixed Footer 和固定底部 padding。
- 拖拽手柄位于 Composer 上边缘，使用 Pointer Events + pointer capture。
- 默认高度 168px，最小 128px，最大为可用高度 60%，同时保留至少 160px 消息区。
- 双击恢复默认高度；键盘方向键可以微调；高度写入 Webview state。
- 260px、350px、480px、600px 宽度均不能产生页面级横向滚动。
- 底栏控件按优先级收缩：文字省略、模型只显示短名，发送按钮始终可见。

### 7.5 结构化消息

- Markdown/Text：语法高亮、复制按钮、链接确认。
- Reasoning：默认折叠，显示运行/完成状态。
- Tool/Command：名称、状态、耗时、折叠后的输入/输出、错误。
- Question：单选/多选/自由输入后响应 OpenCode Question API。
- Permission：准确显示动作、路径/命令、作用域；提供允许一次、始终允许、拒绝。
- Diff：文件路径、`+/-` 行数、展开 patch、在 VS Code Diff Editor 打开。
- Error/Retry：错误摘要、诊断 ID、重试或重新连接。

Markdown 渲染必须 sanitize；命令输出和工具参数默认截断，展开时按大小上限加载。

## 8. 功能设计

### 8.1 Plan 与 Craft

#### Plan

- UI 显示 `Plan`，Prompt 使用 OpenCode `plan` agent。
- 首版禁用写文件和 Shell 类工具，只允许读取/搜索/分析，避免仅靠提示词保证只读。
- Assistant Plan 完成后显示：`保存方案`、`执行方案`、`继续讨论`。
- `保存方案` 由 Extension Host 通过 VS Code Save Dialog 写入用户选择的 Markdown 文件，覆盖前再次确认；不固定覆盖根目录 `PLAN.md`。
- `执行方案` 保持同一个 Session，下一轮切换为 `build` agent。

#### Craft

- UI 显示 `Craft`，Prompt 使用 OpenCode `build` agent。
- 工具执行使用 OpenCode 原生 Permission 事件，不解析模型文本来猜工具或 diff。
- 请求结束后调用 `session.diff` 显示变更摘要和原生 Diff Editor。
- 默认只提供 Permission 的逐项审批；“允许全部”只能用于同类型、同工作区作用域的文件写入，不能批量批准 Shell、网络或工作区外访问。

#### 关于“执行后逐文件接受/拒绝”

原需求描述的是模型先改完，再让用户逐文件接受/拒绝。OpenCode 原生 Permission 是执行前审批，两者语义不同：

- 如果直接改真实工作区再回滚被拒文件，会覆盖用户同期编辑，并且不能回滚命令、网络和工作区外副作用。
- 如果要严格实现，需要让 Craft 在隔离 worktree/临时镜像中运行，再把用户接受的 patch 应用到真实工作区。
- 当前根目录不是 Git 仓库，因此仅依赖 `git worktree` 也不能覆盖所有场景。

推荐 MVP 先采用“执行前审批 + 执行后 Diff 总结”。严格的“执行后逐文件接受/拒绝”作为独立安全阶段，先限定 Git 工作区，再评估非 Git 镜像策略。

### 8.2 `@` 文件引用

- 点击 `@` 或在 Textarea 输入 `@` 打开工作区文件模糊搜索。
- Extension Host 使用 `workspace.findFiles` 或 OpenCode `/find/file`；排除 `.git`、`node_modules`、构建产物和常见二进制。
- 支持当前文件、最近文件、工作区文件，以及编辑器选区 `@path#Lx-Ly`。
- Webview 保存结构化 Chip；发送时由 Host 转成 Stage -1 在 1.18.25 实测确认可接受的 File Part 或文本引用。
- 路径必须规范化并验证仍在当前 workspace；符号链接解析后再次检查边界。
- 默认不把整个文本文件正文复制进 Prompt；让 OpenCode 原生文件工具按需读取。

### 8.3 图片附件

- 支持文件选择、剪贴板粘贴和拖放。
- 支持 PNG/JPEG/WebP；GIF 首版取静态帧，SVG 默认拒绝或安全栅格化。
- 默认限制：最多 5 张、单张编码前 5 MB、单次总载荷 15 MB；具体数值在合同/性能测试后固化。
- 读取后修正方向、必要时压缩，按 OpenCode File Part/Data URL 契约发送 base64。
- 切换到不支持图片的模型时保留附件但禁止发送，并说明原因。
- base64 不进入日志、workspaceState、globalState 或长期 Webview state；发送完成后释放 Object URL 和内存。

### 8.4 模型与自定义 Provider

- 模型下拉内容始终来自 OpenCode Provider/Config API，按 Provider 分组并展示连接、能力和上下文限制。
- 不在插件代码里维护易过期的完整模型 ID 表。
- 设置页提供 OpenAI、Anthropic、DeepSeek、GLM、Qwen、Kimi 等 Provider 模板；模板只提供协议和常见字段，真实可选模型仍从 OpenCode/Models.dev 或用户输入获得。
- OpenAI 兼容模板使用 OpenCode 对应的 `@ai-sdk/openai-compatible` 配置。
- Anthropic 兼容模板使用 OpenCode 对应 Anthropic provider/package 和可配置 baseURL；具体字段以 1.18.25 schema 为准。
- baseURL、模型 ID、显示名和能力写入 OpenCode Config；API Key 通过 native password input 收集，由 Extension Host 调用 OpenCode Auth API，不能存入 Webview 或明文项目配置。
- 外部 Server 若不是 loopback，发送凭据前必须是 HTTPS 或由用户明确接受风险；建议同时使用 Server Basic Auth。
- 新增/更新 Provider 后刷新 Server 配置和模型列表；失败时展示 OpenCode 原始错误的脱敏摘要。

### 8.5 Skill

官方 VS Code 0.0.13 插件不扫描、复制或加载 Skill；Skill Loader 位于 OpenCode 进程。RainEye 不实现第二套 Loader，完全复用 1.18.25 的官方发现规则：

- OpenCode 配置目录中的 `{skill,skills}/**/SKILL.md`。
- 项目和用户目录中的 `.agents/skills/**/SKILL.md`。
- 项目和用户目录中的 `.claude/skills/**/SKILL.md`，除非官方环境开关禁用。
- `opencode.json` 的 `skills.paths: string[]`，相对路径按当前 workspace directory 解析，也支持绝对路径和 `~/`。
- `opencode.json` 的 `skills.urls: string[]`，由 OpenCode 官方 Discovery 拉取和扫描。

OpenCode 读取 `SKILL.md` frontmatter，按名称建立实际可用列表；模型先看到名称、描述和位置，只有调用原生 `skill` tool 时才加载正文。RainEye 的职责限定为：

- 从 OpenCode 官方 `/skill`/SDK 能力读取“进程实际发现”的列表，不用插件自行扫描结果冒充已加载状态。
- 设置页直接编辑官方 `skills.paths` 和 `skills.urls`，不再复制用户目录到 `.opencode/skills`。
- Composer 提供 `Auto + 单个显式 Skill`；`Auto` 完全交给 OpenCode，显式选择只要求 OpenCode 调用原生 `skill` tool，不把 `SKILL.md` 正文拼进 Prompt。
- 配置变化后调用官方 config invalidate/instance lifecycle 能力并重新读取 `/skill`；1.18.25 是否需要 dispose/reconnect 由 Stage -1 合同测试确定。
- UI 可提示重复名称、无 description、路径不存在等 OpenCode 返回的诊断，但不扩展或改变官方 schema。

实现依据：[OpenCode 1.18.25 Skill Loader](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/opencode/src/skill/index.ts)、[Skill 配置 schema](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/core/src/v1/config/skills.ts)。

### 8.6 MCP

官方 VS Code 0.0.13 插件不创建 MCP Client；OpenCode 进程读取合并后的 `config.mcp`，建立连接、维护状态、列举 Tools/Prompts/Resources，并把可用工具暴露给 Agent。RainEye 不直接依赖 MCP SDK，也不自行启动 MCP。

设置页严格映射 OpenCode 1.18.25 的两种官方配置：

- `type: "local"`：`command: string[]`，以及可选的 `cwd`、`environment`、`enabled`、`timeout`。OpenCode 进程使用 stdio 启动并管理子进程。
- `type: "remote"`：`url`，以及可选的 `headers`、`enabled`、`timeout`、`oauth`。OpenCode 进程先尝试 Streamable HTTP，再自动回退 SSE；UI 不让用户选择一个与官方 schema 不一致的第三种 `type: "sse"`。
- `oauth` 使用官方字段 `clientId`、`clientSecret`、`scope`、`callbackPort`、`redirectUri`，也可以设为 `false` 禁用自动 OAuth。

运行状态直接展示官方状态：`connected`、`disabled`、`failed`、`needs_auth`、`needs_client_registration`。默认 timeout 不在插件中另写一套常量；字段省略时完全使用当前 OpenCode 进程默认值。

数据路径：

1. `GET /mcp` 获取真实运行状态。
2. `GET/PATCH /config` 按官方 schema 获取和更新配置；项目级/用户级作用域由设置页明确选择。
3. 使用 OpenCode 官方 MCP add/connect/disconnect/OAuth API 完成运行时操作，不在 Extension Host 创建 MCP Client。
4. 每次保存后重新读取 Config 与 MCP Status，不能只在 UI 本地标记成功。

编辑/删除是否能通过 1.18.25 的 Config PATCH 安全合并，需要在 Stage -1 实测。若服务器没有可靠删除语义，首版提供“在编辑器中打开配置并定位 MCP”作为保底，不伪造删除成功。

“与官方实现一样”的产品含义是：表单字段、校验、配置落盘、连接顺序、OAuth 和状态均服从 OpenCode 1.18.25；RainEye 只做可视化控制面，不增加私有 MCP 协议。

实现依据：[OpenCode 1.18.25 MCP schema](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/core/src/v1/config/mcp.ts)、[OpenCode 1.18.25 MCP Runtime](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/opencode/src/mcp/index.ts)。

### 8.7 设置页

设置页采用侧边栏内部全宽路由：

- Connection：状态、URL、版本、目录、CLI 路径、重新连接、启动新实例。
- Providers & Models：已连接 Provider、默认模型、自定义 Provider、刷新。
- Skills：已发现、官方 `paths/urls` 配置、刷新和诊断。
- MCP：配置、transport、状态、工具数量、OAuth、错误。
- General：默认模式、默认模型、Composer、日志级别。
- Diagnostics：OpenCode/SDK/扩展版本、健康检查、复制脱敏诊断。

普通布尔/字符串设置同时映射到 VS Code Settings；API Key 和 Password 只通过 native password input/SecretStorage/Auth API 处理。

## 9. 安全与权限

- 未信任工作区不自动启动 CLI、不发送 Prompt、不批准工具、不修改 Skill/MCP/Provider 配置。
- 外部 Server 默认只允许 loopback HTTP；远程地址建议强制 HTTPS。
- Managed Server 绑定 `127.0.0.1`，不绑定 `0.0.0.0`。
- 对显式路径 Permission 做 realpath/符号链接解析和 workspace boundary 校验；工作区外默认拒绝。
- Shell Permission 即使用户批准也不等于操作系统沙箱，UI 和 README 必须明确说明。
- Webview CSP、nonce、消息 schema、HTML sanitize 和链接确认全部作为发布门禁。
- 日志禁止出现 Prompt 正文、文件正文、图片 base64、API Key、Server Password、Authorization header。
- `config.patch` 前先读取、生成预览、只修改目标字段、失败时不覆盖原配置；对用户并发修改做版本/内容冲突检测。

## 10. 工程目录建议

```text
opencode-raineye/
  package.json
  tsconfig.json
  esbuild.mjs
  vite.config.ts
  .vscodeignore
  src/
    extension.ts
    commands/
      registerCommands.ts
    connection/
      ConnectionManager.ts
      CliLocator.ts
      ManagedServer.ts
      ServerDiscovery.ts
    opencode/
      OpenCodeClientAdapter.ts
      EventStreamManager.ts
      OpenCodeEventAdapter.ts
      SessionController.ts
      OpenCodeConfigService.ts
      PolicyService.ts
    attachments/
      AttachmentService.ts
    views/
      ChatViewProvider.ts
    shared/
      protocol.ts
      schemas.ts
    webview/
      index.tsx
      App.tsx
      components/
      store/
      styles/
      utils/
  test/
    unit/
    contract/
    fixtures/
    integration/
    vscode/
  media/
    icons/
  dist/
    extension.js
    webview/
```

构建约束：

- Extension Host 使用 esbuild 单文件 bundle，target 与 `engines.vscode` 的 Node 版本对齐。
- Webview 使用 Vite；宿主和 Webview 分别执行 `tsc --noEmit`。
- `build` 先 clean，再双端 typecheck、测试、extension bundle、webview bundle。
- `vsce package` 不重复执行两遍 build。
- VSIX 内容使用 allowlist 验证，不打包测试 fixture、旧方案、源码映射和 Secret。

建议最低 VS Code 版本与官方 0.0.13 保持 `^1.94.0`，除非后续确认所用 API 可下调。

## 11. 实施阶段与验收

### Stage -1：合同与环境探针（P0）

工作：

- 修复或绕开本机 CLI 配置路径冲突。
- 锁定 `opencode-ai` 和 `@opencode-ai/sdk` 为 1.18.25。
- 启动 headless Server，保存 `/doc` 和关键事件的脱敏 fixture。
- 实测 health/path/session/promptAsync/events/messages/status/abort/diff/permission/question/provider/auth/agent/skill/mcp/config。
- 验证 Windows `.exe/.cmd` 启动和优雅停止。

验收：

- 最小脚本连续 3 轮同 Session 对话成功，无事件流泄漏。
- 能收增量文本、工具、Permission、Question、idle/error。
- 能列出真实 Provider/Model/Agent/MCP/Skill。
- 形成 `CONTRACT_1.18.25.md`；所有未验证接口在开发计划中降级或删除。

### Stage 0：可安装骨架（P0）

工作：manifest、View Container、命令、双端构建、CSP、主题变量、错误边界和 VSIX 脚本。

验收：

- Extension Development Host 能打开 RainEye 侧边栏。
- 深色/浅色/高对比度下空页面可读。
- typecheck/build/package/verify 全部成功。
- 干净 VS Code Profile 中 VSIX 可安装、激活、卸载。

### Stage 1：连接与进程管理（P0）

工作：CliLocator、发现候选、连接弹窗、Managed Server、health/path/version、Output Channel、Workspace Trust。

验收：

- 能连接配置 URL、官方扩展 Terminal 端口和默认 4096。
- 无 Server 时自动启动 1.18.25 headless Server。
- 发现 Server 时可选择连接或启动新实例。
- 外部 Server 不被停止；owned Server 退出不留孤儿进程。
- PowerShell 禁止 `.ps1` 时仍可通过 `.exe/.cmd` 启动。

### Stage 2：Session 与可靠消息链路（P0）

工作：SessionController、SSE、EventAdapter、请求状态机、新对话、历史、取消、恢复。

验收：

- 连续 10 轮上下文正确，不停留在 thinking。
- 新建 3 个会话并从历史恢复，Reload Window 后仍正确。
- SSE 人为断开后能重连并通过 messages 恢复最终结果。
- 切换会话时不串消息，Stop 有明确终态。

### Stage 3：CodeBuddy 风格主界面（P1）

工作：Header、Welcome、MessageList、Composer、拖拽、响应式布局、设置/历史路由、结构化基础卡片。

验收：

- 260/350/480/600px 无横向页面滚动或控件裁切。
- Composer 从最小拖到最大，消息区仍可用。
- 长标题、20 行 Prompt、20 个文件 Chip 和 5 张图不重叠。
- 键盘、屏幕阅读标签、主题和缩放达到可用标准。

### Stage 4：附件、模型与 Skill（P1）

工作：`@` 搜索、编辑器引用、图片、模型选择、Provider 模板、Skill Auto/显式选择与导入。

验收：

- `@` 可搜索、键盘选择、移除并正确发送相对路径/行号。
- 图片选择、粘贴、预览、限制和模型能力检查均生效。
- 模型列表来自 Server；新增一个 OpenAI 兼容和一个 Anthropic 兼容配置可用。
- 显式 Skill 能从 Tool 事件确认被 OpenCode 加载。

### Stage 5：MCP 与完整设置（P1）

工作：Connection/Provider/Skill/MCP/Diagnostics 设置页，MCP CRUD 或可靠降级，OAuth。

验收：

- stdio 和 remote MCP 能配置、连接并显示真实状态/错误。
- Reload Window 后配置与 OpenCode 一致。
- 凭据不出现在 Webview state、日志或项目明文配置。
- 不支持的 transport 被明确拒绝，不显示假成功。

### Stage 6：Permission、Diff 与 Plan/Craft 工作流（P0/P1）

工作：原生 Permission/Question、Plan 保存/执行、Craft Diff、Diff Editor、批量审批限制。

验收：

- Plan 默认不能修改工作区；保存方案只写用户确认的路径。
- Plan -> Craft 同 Session 保留上下文。
- Craft 写入前可批准/拒绝，结束后显示准确文件与 `+/-`。
- 拒绝 Permission 不修改文件，不残留 loading。
- 如果用户确认严格后置审批，再单独验收隔离工作区与逐文件应用。

### Stage 7：质量与发布（P0）

工作：单元、合同、真实 Server 集成、VS Code E2E、视觉回归、README/CHANGELOG、VSIX 清单。

验收：

- 核心状态机、事件 adapter、路径边界、配置合并、附件预算有单测。
- 1.18.25 fixture 合同测试固定通过。
- 全新 Profile 安装 VSIX 后完成：连接、新会话、聊天、Plan/Craft、附件、模型、Skill、MCP、权限、历史恢复。
- 最终产物为经过安装验证的 `out/opencode-raineye-<version>.vsix`。

## 12. 测试矩阵

| 维度 | 首发必须覆盖 |
| --- | --- |
| OS/Shell | Windows 11；PowerShell；`.ps1` 被禁；`.cmd`/`.exe` |
| VS Code | 最低支持版本、当前稳定版；干净 Profile |
| OpenCode | 锁定 1.18.25；同 major 的未验证版本给出警告 |
| 连接 | managed、配置 URL、官方 Terminal、Server 重启、401、端口占用 |
| 工作区 | Git、非 Git、无工作区、多根基础流程、未信任工作区 |
| UI | 260/350/480/600px；100%/150% 缩放；dark/light/high contrast |
| 消息 | text、reasoning、tool、question、permission、diff、error、cancel |
| 附件 | 文件、选区、图片、超限、二进制、符号链接越界 |
| 配置 | Provider、Auth、Skill、stdio MCP、remote/OAuth MCP、并发修改 |

## 13. 主要风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| OpenCode API/事件版本变化 | 编译通过但运行卡住 | 锁版本、读取 `/doc`、运行时 schema、fixture 合同测试 |
| 任意 TUI 随机端口不可发现 | 无法满足“所有已有进程” | 只承诺可验证候选；支持官方 Terminal env、配置 URL、默认端口、managed metadata |
| Craft 后置逐文件审批语义 | 回滚不安全、可能覆盖用户编辑 | MVP 前置 Permission；严格版使用隔离工作区 |
| Webview 过重或不安全 | 性能/Secret 风险 | 纯 UI、虚拟列表、CSP、Host-only Secret/SDK/FS |
| Windows CLI 入口与配置损坏 | Server 无法启动 | 直接 exe、诊断分级、Stage -1 环境探针 |
| MCP/Provider Config 合并覆盖 | 用户配置丢失 | 目标字段 patch、冲突检测、预览、备份/回读验证 |
| 多根/Remote 生命周期复杂 | 误连目录或启错机器 | 首发限制一个活动 directory，始终在 Extension Host 环境执行 |

## 14. 决策记录与默认项

### D1：主界面技术（已确认）

**已确认：原生 View Container + 最小 WebviewView。**

如果坚持完全不用 Webview，则必须接受主界面退化为 TreeView/QuickPick/Terminal，无法按参考图实现 Composer、附件架和结构化卡片。

### D2：Craft 审批语义（已确认）

**已确认：执行前 Permission + 执行后 Diff 总结。**

如果必须执行后逐文件接受/拒绝，需要把隔离工作区列为 P0，开发和测试范围会明显增加，并需决定非 Git 工作区是否支持。

### D3：已有 OpenCode 的发现范围（已确认）

**已确认：按“配置 URL → managed 元数据 → 最近连接 → 官方 Terminal env → 可选 mDNS → 本机 LISTENING 端口 → 默认端口”收集候选，并经 health/path 验证。没有发现时由用户选择新建实例，或手动填写“本机 + 端口”“URL + 端口”。**

未知随机端口的外部 PowerShell/OpenCode 进程通过“枚举监听端口 + OpenCode API 鉴别”覆盖；PID 仅作为可用元数据展示和保存，不作为身份判断依据。

### D4：Skill/MCP 实现边界（已确认）

**已确认：Skill 和 MCP 与 OpenCode 1.18.25 官方实现完全一致。RainEye 只编辑官方配置、调用官方 API、显示官方列表与状态。**

MCP UI 只提供官方 `local` 和 `remote` 两类。`remote` 的 Streamable HTTP/SSE 回退及 OAuth 由 OpenCode 进程处理；插件不自行发明 transport。Skill 自定义目录使用官方 `skills.paths/skills.urls`，不再复制目录或实现私有 Loader。

### D5：首发范围

**推荐首个可验收版本完成 Stage -1 至 Stage 4，再进入 MCP 和严格权限增强。**

这样可以先交付稳定的连接、对话、历史、目标 UI、附件、模型和 Skill，避免 MCP/隔离审批拖住基础体验验证。

## 15. 完成定义

只有同时满足以下条件才算项目完成：

1. 需求项有对应自动或人工验收记录，不以 mock 数据代替 OpenCode 真实返回。
2. 新安装 VSIX 可在目标 Windows/VS Code/OpenCode 版本运行。
3. 连续会话、断流恢复、取消、权限拒绝均无永久 thinking。
4. UI 在目标宽度和主题下无裁切、重叠、不可操作控件。
5. Secret、Prompt、附件内容不进入日志或发布包。
6. 外部 Server 生命周期与 managed Server 明确分离。
7. 不支持或未验证的能力明确降级，不显示成功假状态。
