# OpenCode RainEye 项目审计与修复方案

> 审计日期：2026-08-28  
> 审计基线：外部 `plan.md`、仓库 `requirement.md`、当前源码、全新构建产物与 VSIX 文件清单  
> 结论口径：以“用户安装 VSIX 后能够连接 OpenCode 并安全完成一次 Plan/Craft 工作流”为验收标准，而不是以文件是否存在为完成标准。

## 1. 执行结论

当前项目已经完成了扩展骨架、React 侧边栏和多数功能入口，但还不是可交付版本。

- Extension Host 源码可以通过 TypeScript 严格编译。
- Vite 可以生成 Webview 的 JS/CSS。
- `vsce` 可以生成 VSIX，但该 VSIX 缺少运行时必需的 `out/webview/provider.js`，扩展无法正常激活。
- Webview 源码存在明确的 TypeScript 错误，只是 Vite 不做类型检查，因此构建没有失败。
- 聊天客户端调用的是 `/v1/chat/completions`，与当前 OpenCode 官方 Server API 不匹配。
- Craft 的 diff 应用不是补丁应用，而是将 diff hunk 拼成字符串后覆盖整个文件，存在数据损坏和越界写入风险。
- 模型、API Key、Plan/Craft、图片、Skills/MCP 都有 UI 或代码骨架，但没有形成可验收的端到端闭环。
- 仓库没有自动化测试，也没有真实 OpenCode 服务的集成测试。

因此，当前状态建议定义为：**原型 UI 已完成，核心运行链路未完成，VSIX 不可发布**。

## 2. 本机 OpenCode 检查结果

已发现 OpenCode Desktop：

```text
C:\Users\Foreverain\AppData\Local\Programs\@opencode-aidesktop\OpenCode.exe
ProductVersion: 1.18.23.0
```

同时确认：

- 当前没有运行中的 OpenCode 进程。
- 当前进程环境的 `PATH` 中没有可解析的 `opencode` CLI。
- `Get-Command opencode` 和 `where opencode` 均失败。
- Desktop 安装目录中未发现独立的 `opencode.exe`、`opencode.cmd` 或 `opencode.ps1` CLI 启动器。

这说明“已安装 Desktop”不等于扩展当前能执行 `spawn("opencode", ["serve", ...])`。扩展应显式区分：

1. 已有 Server URL，可直接连接。
2. 已安装并可执行的 OpenCode CLI，可由扩展启动 Server。
3. 仅安装 Desktop，但没有可发现的 CLI/Server，需要给出诊断和配置入口。

不建议直接把 Desktop 的 `OpenCode.exe` 当作 CLI 使用，除非其官方文档明确承诺支持 `serve` 子命令。

## 3. 原计划完成情况

| 需求 | 当前实现 | 审计状态 | 主要差距 |
|---|---|---|---|
| 可安装 VSIX | 能生成 VSIX | 未完成 | VSIX 缺 `provider.js`，不能正常激活 |
| 自动发现已有进程 | 默认端口、进程和配置文件扫描 | 部分完成 | 健康检查不是 OpenCode 专用；多进程永远选第一个；不校验项目目录 |
| 无进程时启动 OpenCode | `spawn(command, serve...)` | 部分完成 | 本机 CLI 不可解析；`port` 设置未使用；日志管道未消费 |
| 内置/自定义模型 | 硬编码模型和 settings 数据结构 | 原型 | `baseUrl`、`apiKey` 未进入请求；没有添加模型 UI；模型 ID 格式不符合原生 API |
| OpenAI/Anthropic 兼容 | 数据结构标注 provider | 未完成 | 没有两种协议适配，也没有调用 OpenCode Provider/Auth API |
| Plan 模式 | system prompt + 审批卡片 + 写 `PLAN.md` | 部分完成 | 没有会话上下文；不是 OpenCode 原生 `plan` agent；拒绝后无法真正继续原会话 |
| Craft 模式 | system prompt + 正则解析 diff + 审批 UI | 实现有误 | 覆盖文件、批量审批无效、路径未限制、未使用 OpenCode `build` agent/session diff |
| 图片输入 | 文件选择/粘贴后转 Data URL | 部分完成 | 没有压缩、总载荷限制、模型能力校验；Extension 侧图片模块未被调用 |
| `@文件` | 文件选择器和内容分层 | 部分完成 | 没有 `@` 自动完成；附件在输入框中不可见/不可移除；没有全局预算 |
| 输出渲染 | 文本正则识别代码、bash、问题 | 原型 | 没有消费 OpenCode 的结构化 message parts/tool events |
| Skills | 复制目录和列举目录 | 部分完成 | 不校验 `SKILL.md`；没有覆盖确认、移除和真实加载状态 |
| MCP | 抽屉 UI + CLI 字符串调用 | 部分完成 | Webview 类型错误；命令注入风险；SSE 分支无有效参数；解析依赖不稳定文本 |
| 错误恢复 | 日志和少量错误文本 | 未完成 | 无连接状态机、重试/取消、CLI 缺失引导、进程崩溃恢复 |
| 自动化测试 | 无 | 未完成 | 关键解析、写入、API 和 VSIX 均无测试 |

## 4. P0：发布前必须修复

### P0.1 构建目录互相覆盖

证据：

- 根 `tsconfig.json` 把 `src/webview/provider.ts` 编译为 `out/webview/provider.js`。
- `vite.config.mts` 又将前端输出到 `out/webview`，并设置 `emptyOutDir: true`。
- 全新 `npm run package-vsix` 返回成功，但磁盘和 VSIX 中都没有 `out/webview/provider.js`。
- `out/extension.js` 仍执行 `require("./webview/provider")`。

推荐修复：使用 **esbuild 打包 Extension Host 为单文件**：

```text
dist/extension/extension.js
dist/webview/index.html
dist/webview/assets/index.js
dist/webview/assets/index.css
```

备选最小改动：把 `tsc.outDir` 改为 `out/extension-host`，把 `package.json.main` 改为 `./out/extension-host/extension.js`，Vite 继续使用 `out/webview`。两个构建目标必须物理隔离。

验收：解包 VSIX 后，`package.json.main` 指向的文件及其所有运行时依赖都存在；在 Extension Development Host 中扩展激活无异常。

### P0.2 Webview 类型检查被绕过

`webview/tsconfig.json` 引用的 `tsconfig.node.json` 同时设置 `composite: true` 和 `noEmit: true`，执行项目类型检查时报 `TS6310`。此外它仍包含已不存在的 `vite.config.ts`，而实际文件是 `vite.config.mts`。

绕过项目引用直接检查源码后，发现至少 18 个错误：

- `SkillInfoPayload`、`McpServerPayload` 未导出。
- `file:pick`、`skills:*`、`mcp:*` 消息不在 Webview 的消息联合类型中。
- 缺少 `acquireVsCodeApi` 全局声明。

推荐修复：

- 消息协议只保留一个来源，例如仓库根 `shared/messages.ts`，Extension 与 Webview 共同引用。
- 在共享协议上增加运行时校验，至少对所有来自 Webview 的写操作消息进行验证。
- 增加 `typecheck:webview`，并让 `compile` 在 Vite 前强制执行。
- 修正或移除无效的 TS project reference。

### P0.3 Webview API 被重复获取

`webview/src/hooks/useExtension.ts` 每次 `postMessage` 都调用 `acquireVsCodeApi()`。该 API 应在 Webview 生命周期内只获取一次。初始化阶段先发送 `ready`，随后请求模型列表时就可能第二次获取并失败。

推荐修复：模块级或 hook ref 中只创建一次 API 实例，后续复用；同时处理 Extension 侧尚未处理的 `ready` 消息。

### P0.4 OpenCode API 协议不匹配

当前客户端：

- 使用 `HEAD /` 健康检查。
- 使用 `POST /v1/chat/completions` 聊天。
- 自行解析 OpenAI SSE `choices[].delta.content`。

当前 OpenCode 官方 Server API 提供的是：

- `GET /global/health`
- `POST /session` 创建会话
- `POST /session/:id/message` 或 `prompt_async` 发送消息
- `GET /event` 订阅结构化事件
- `GET /session/:id/diff` 获取会话 diff
- `GET /provider`、`GET /config/providers` 获取模型/Provider
- `GET/POST /mcp` 管理 MCP

推荐直接使用官方 `@opencode-ai/sdk`，不要维护自制 OpenAI Chat Completions 兼容层。官方 SDK 由 OpenAPI 生成，能提供 Session、Part、Event、Provider 和错误类型。

参考：

- [OpenCode Server API](https://opencode.ai/docs/server/)
- [OpenCode JS/TS SDK](https://opencode.ai/docs/sdk/)

### P0.5 Craft 写入会损坏文件且可越界

`src/files/diffManager.ts` 的 `applyUnifiedDiff()` 只收集上下文行和新增行，然后把结果作为完整文件写入。这不是真正应用 unified diff，多 hunk 文件会丢失未出现在 hunk 中的全部内容。

同时，模型回复中的路径可以是绝对路径或包含 `..`，最终未经 workspace 边界验证就写入磁盘。Webview 还把 `filePath` 和 `newContent` 原样回传，Extension Host 对其完全信任。

立即措施：

- 在修复前禁用所有 Craft 写入按钮，避免用户数据损坏。
- 所有待审批变更仅保存在 Extension Host，Webview 只能发送不可猜测的 `changeSetId/fileId/decision`。
- 对目标路径执行规范化和 realpath 检查，必须位于已授权 workspace 内。
- 使用成熟补丁库、Git 或 VS Code `WorkspaceEdit`，并处理未保存编辑器内容、编码和换行符。

## 5. P1：核心链路重构

### P1.1 使用原生 Session + Agent

OpenCode 内置 primary agents 是 `plan` 和 `build`。UI 可以继续显示 `Plan` 和 `Craft`，但应映射为：

```text
Plan  -> agent: "plan"
Craft -> agent: "build"
```

不要再用一段 system prompt 模拟权限。原生 Plan agent 对 edit/bash 默认受限制，Build agent具备开发工具能力。参考 [OpenCode Agents](https://opencode.ai/docs/agents/)。

每个聊天页必须持有真实 `sessionId`，否则当前每次请求都只有本轮 system/user 消息，界面看似连续，模型实际没有历史上下文。

建议的数据流：

```text
Webview intent
  -> Extension command handler
  -> OpenCode SDK session.create/session.prompt
  -> SDK event.subscribe
  -> normalize Event/Part
  -> Webview typed event renderer
```

### P1.2 Craft 审批方案选择

原需求要求“OpenCode 完成修改后，再逐文件同意或拒绝”。这与 Build agent 直接修改当前工作区存在天然冲突。

#### 方案 A：隔离工作区执行，推荐

- 为每个 Craft session 创建临时 Git worktree；非 Git 项目使用受控镜像目录。
- OpenCode Build 在隔离目录中执行。
- 完成后调用 session diff 或 Git diff 获得真实变更。
- 用户逐文件批准后，将对应 patch 应用到真实 workspace。
- 拒绝或取消时直接删除隔离环境，原工作区不受影响。

优点：严格满足事后审批；拒绝安全；支持真实工具链。  
代价：需要处理未提交修改、非 Git 项目、依赖目录和大仓库性能。

#### 方案 B：原生 Permission 审批，开发量较小

- Build 直接运行在真实 workspace。
- 对 edit/bash 权限使用 `ask`，通过 OpenCode permission API 转发审批。
- 用户是在操作发生前批准，而不是看到最终 diff 后批准。

优点：与 OpenCode 原生机制一致。  
代价：不完全满足当前“事后逐文件审批”的产品要求。

#### 不采用：继续解析 LLM 文本 diff

文本格式不可保证，无法覆盖 rename/delete/binary/mode change，也容易被提示注入影响路径。现有实现不应继续作为 fallback 写入方案。

### P1.3 进程与连接状态机

建议状态：

```text
idle -> locating -> connecting | starting -> connected -> reconnecting -> error
```

修复点：

- 新增显式 `serverUrl` 设置，允许连接用户已启动的 Server。
- `command` 解析不到时展示诊断，不要静默等待 30 秒。
- 使用 `/global/health` 验证服务身份和版本，而不是把任意 HTTP 服务当 OpenCode。
- 连接已有服务后调用 `/path`，确认它对应当前 workspace；不匹配时让用户选择。
- 多个候选服务必须提供 QuickPick，不能固定连接第一个。
- 使用配置的 `opencodeRaineye.port`；当前常量 `6688` 忽略了该设置。
- `spawn` 使用参数数组且默认 `shell: false`；持续消费 stdout/stderr 并写入 Output Channel。
- 支持取消启动、超时后重试，以及扩展关闭时明确选择是否终止托管进程。
- 如启用 `OPENCODE_SERVER_PASSWORD`，凭据存入 `SecretStorage` 并支持 HTTP Basic Auth。

### P1.4 模型与 Provider 以 OpenCode 为事实源

当前硬编码模型只能作为空状态示例，不应作为运行时模型目录。推荐：

- 从 `/provider` 或 `/config/providers` 获取当前 OpenCode 实例真实可用的 provider/model。
- 发送消息时使用 `{ providerID, modelID }`，而不是单个 `deepseek-chat` 字符串。
- Provider 凭据通过 OpenCode `/auth/:id` 或 SDK auth API 配置。
- 自定义 base URL/模型通过 OpenCode config API 或明确更新 `opencode.json`，不要只存在 VS Code settings 中。
- API Key 使用 `SecretStorage`；不要使用一个全局 Key 覆盖所有 provider，也不要把 Key 返回给 Webview。

## 6. P2：交互和功能补齐

### P2.1 流式消息与结构化渲染

- Extension 当前逐块发送后，又以 `done: true` 发送完整累计回复，前端会把全文追加第二次。
- 完成事件只应发送状态，不应重复发送正文。
- 直接渲染 OpenCode 的结构化 message parts：text、tool、file、reasoning、question、permission、error。
- 命令卡片显示命令、状态、退出码和截断后的 stdout/stderr。
- 使用可靠 Markdown 渲染器并进行 HTML sanitize，不再依靠行首 `$` 或末尾 `?` 猜测消息类型。
- 增加停止生成、重试、自动滚动和会话恢复。

### P2.2 文件引用

- 实现真正的 `@` 自动完成，可使用 `vscode.workspace.findFiles` 或 OpenCode `/find/file`。
- 附件状态统一放在 App/Store 中，并显示在输入框内；当前 `pendingFiles` 与 ChatInput 内部 `files` 是两个断开的状态。
- 限制为 workspace 内文件，跳过二进制文件和敏感文件规则。
- 使用所有附件共享的 token/字符预算，而不是每个文件各自 8000 字符。
- 原生 OpenCode agent 已有文件读取工具，接通 Session API 后无需再发明基于文本标签的 `read_file` 协议。

### P2.3 图片

- Webview 选择/粘贴流程可保留。
- 发送前按最长边、文件大小和总会话载荷压缩；明确错误提示。
- 根据 OpenCode 返回的模型能力决定是否允许图片。
- 使用 SDK 定义的原生 Part 类型，不要假定 OpenAI `image_url` 就是 OpenCode 接口格式。
- 清理临时文件；当前 `imageAttachment.ts` 写入临时目录但没有清理，而且该模块实际上未接入消息链路。

### P2.4 Skills 和 MCP

Skills：

- 校验目录中存在合法 `SKILL.md`，复制前显示目标路径和覆盖确认。
- 区分“目录存在”和“OpenCode 已加载”，必要时刷新实例或查询实际能力。
- 支持移除、打开目录、项目级/用户级目标选择。

MCP：

- 优先使用 Server `GET/POST /mcp`，不解析 CLI 的人类可读输出。
- 如果保留 CLI fallback，必须使用 `execFile` 参数数组，禁止 shell 字符串拼接。
- 当前 `sse` 分支没有把 URL 加入参数，却仍会报告成功，必须修复。
- 对 transport 使用 OpenCode 当前 schema 做运行时校验。

## 7. P3：Manifest、UI 与工程质量

- 自定义 Activity Bar container 已声明为 `opencodeRaineye`，但 view 实际注册在 `explorer`；应把 view 放入对应 container。
- Activity Bar 图标使用真实 SVG 文件；不要依赖 `$(comment-discussion)` 是否被该 manifest 字段接受。
- `openSidebar` 命令应执行 container/view focus 命令，当前 `provider.reveal()` 在 view 尚未 resolve 时什么也不做。
- `manageProviders`、`manageSkillsMcp` 已写入 manifest，但没有注册命令处理器。
- 固定 CSP nonce 改为每次生成随机值；同时收紧 `localResourceRoots`。
- 使用 VS Code theme CSS variables，避免只适配固定深色主题。
- 增加 React Error Boundary 和连接状态空页面。
- 删除未使用依赖和源码目录中的生成文件 `webview/src/types/messages.js(.map)`。
- 清理构建目录后再构建；当前 VSIX 还包含 `FIX_REPORT.md`、`.codebuddy/plans` 和 `out/.vscode`。
- `.vscodeignore` 应只允许发布运行时必需文件、README、LICENSE 和图标。
- `package-vsix` 目前先 compile，`vsce package` 又触发 `vscode:prepublish` 再 compile，应该只执行一次。
- 补充真实 repository、publisher、README、icon、版本策略和 changelog。

## 8. 推荐实施阶段

### 阶段 0：恢复可运行交付物

范围：构建目录隔离、Webview 类型检查、单例 VS Code API、正确 view 注册、命令注册、VSIX 内容检查。

验收：

- `npm run typecheck` 成功。
- `npm run build` 成功。
- VSIX 中入口及全部资源存在。
- Extension Development Host 中能打开侧边栏，控制台无异常。

### 阶段 1：接通 OpenCode 原生链路

范围：SDK、CLI/URL 发现、health/path、session、event stream、provider/model、Plan/Build agent。

验收：

- 在 Windows 上能连接用户手动启动的 Server。
- CLI 可用时能启动并连接托管 Server。
- 连续两轮聊天共享同一 session 上下文。
- Plan 不修改工作区；Craft/Build 能产生可查询 diff。

### 阶段 2：安全审批

范围：确定隔离 worktree 或原生 permission 方案；host-side change set；真实 diff preview；逐文件/批量应用；路径边界。

验收：

- 拒绝不会改变真实 workspace。
- 单文件批准只改变该文件。
- Approve All/Reject All 行为真实有效。
- rename/delete/new file/multi-hunk/CRLF/未保存编辑器均有定义和测试。

### 阶段 3：附件、渲染、Skills/MCP

范围：`@` 自动完成、图片限制、结构化 parts、Skill 校验、MCP API。

验收：按 `requirement.md` 逐项执行人工场景，并保留截图和日志。

### 阶段 4：测试与发布

建议测试层级：

- 单元：路径边界、文件预算、change set、事件归一化、CLI 定位。
- 合约：用 mock server 验证 SDK/API 错误和事件顺序。
- 集成：启动真实 OpenCode Server 执行 Plan/Build。
- VS Code E2E：激活、打开 view、发送消息、审批、重载恢复。
- 发布冒烟：安装全新 VSIX，在干净 Extension Host 中完成一轮核心流程。

## 9. 需要共同决定的问题

### 决策 1：Craft 审批语义

- **推荐：隔离 worktree 后事后逐文件审批。** 最符合原需求，安全性最高。
- 备选：OpenCode 原生 permission 事前审批。实现更快，但产品语义需要调整。

### 决策 2：OpenCode 启动责任

- **推荐：同时支持“连接 URL”和“启动 CLI”，连接优先。** Desktop 用户可以连接已有 Server，CLI 用户可以托管启动。
- 不建议让扩展猜测 Desktop 内部实现或直接启动桌面 EXE。

### 决策 3：模型配置归属

- **推荐：OpenCode 是 provider/model/auth 的唯一事实源，插件只提供 UI。** 避免两套配置漂移。
- 备选：插件直连各模型厂商；这会绕过 OpenCode agent/tool/session，等同于另做一个 Agent 平台，不符合项目目标。

### 决策 4：Extension Host 构建

- **推荐：esbuild 单文件 bundle。** 可彻底消除当前 provider 输出丢失和运行时依赖遗漏。
- 备选：继续 tsc，但必须把 Extension Host 和 Webview 输出目录隔离。

## 10. 建议的第一批变更

第一批只恢复“能启动、能打开、能连接”，不要同时修 UI 细节：

1. 隔离构建输出并加入 VSIX 必需文件断言。
2. 修复 Webview tsconfig 和共享消息协议。
3. 单例化 `acquireVsCodeApi`，修复 ready/models 初始化。
4. 修正 view container 与命令注册。
5. 引入 OpenCode SDK，完成 health、path、session create、session prompt 和 event subscribe。
6. 暂时禁用 Craft 写入，只展示原生 session diff。
7. 加入 CLI/Server URL 诊断，明确提示当前机器是“Desktop 已安装，但 CLI 不在 PATH”。
8. 完成一轮真实 Server 集成测试后，再进入安全审批实现。

完成这批后，项目才具备继续扩展功能的稳定基础。
