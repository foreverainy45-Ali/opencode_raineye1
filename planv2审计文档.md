# PLAN_v2 审计文档

> 审计对象：`PLAN_v2.md`  
> 审计日期：2026-08-28  
> 审计范围：构建与打包、OpenCode SDK/API、Windows 进程管理、会话与权限模型、Webview 通信、安全边界、测试和发布

## 1. 审计结论

`PLAN_v2.md` 的总体方向可行：使用官方 OpenCode SDK、将扩展宿主和 Webview 输出目录分离、由 OpenCode 提供 Provider/Model 数据，并按阶段替换当前实现。这些决策能解决现有构建覆盖、协议不一致和硬编码模型等核心问题。

但当前计划仍有若干阻断项。如果直接按现有顺序实施，可能出现以下结果：

- 扩展能打包，但宿主 TypeScript 错误未被发现。
- 在 Windows 上找得到 `opencode.cmd`，却无法通过 `shell: false` 启动。
- Session 创建、事件订阅和权限响应与官方 API 不一致。
- Plan 切换到 Craft 后丢失上下文。
- 命令已获批准，但仍可越过工作区路径边界写文件。
- 旧的差异应用逻辑在新权限系统完成前继续暴露安全风险。

因此建议在原 Stage 0 前增加 **Stage -1：安全与 API 契约确认**，完成关键接口验证和旧危险能力下线后，再进入构建迁移。

## 2. 阻断问题

### 2.1 SDK/API 契约定义不准确

**位置：** `PLAN_v2.md` 第 91-98 行。

当前计划定义：

- `createSession(agent)`
- `subscribeEvents(sessionId)`
- `approvePermission(permissionId)`

这些抽象与 OpenCode 官方接口不完全一致：

1. 创建 Session 时不应假设可以直接传入 agent；agent 和 model 应作为 prompt 参数发送。
2. `/event` 是项目级事件流，不是单个 Session 的专属订阅接口。客户端应建立共享 SSE 连接，再按 `sessionID`、`messageID` 等字段分发事件。
3. 权限响应必须同时携带 `sessionId` 和 `permissionId`，对应 `/session/:id/permissions/:permissionID`。

**建议修改：**

```ts
createSession(input?: { title?: string; parentID?: string }): Promise<Session>
prompt(sessionId: string, input: {
  agent?: string
  model?: ModelRef
  parts: PromptPart[]
}): Promise<void>
subscribeEvents(signal: AbortSignal): AsyncIterable<OpenCodeEvent>
respondPermission(sessionId: string, permissionId: string, response: PermissionResponse): Promise<void>
```

所有事件名、请求体和响应体应直接引用 `@opencode-ai/sdk` 导出的类型，不再手工维护近似类型。

### 2.2 esbuild 不能替代 TypeScript 类型检查

**位置：** `PLAN_v2.md` 第 35-49 行。

esbuild 只转译和打包，不执行完整 TypeScript 类型检查。计划删除原 `compile` 后，仅保留 `typecheck:webview`，会导致扩展宿主代码存在类型错误时仍然产出 VSIX。

**建议修改：**

```json
{
  "scripts": {
    "typecheck:extension": "tsc -p tsconfig.json --noEmit",
    "typecheck:webview": "tsc -p webview/tsconfig.json --noEmit",
    "typecheck": "npm run typecheck:extension && npm run typecheck:webview",
    "build": "npm run clean && npm run typecheck && npm run build:extension && npm run build:webview"
  }
}
```

Stage 0 的验收条件必须同时覆盖宿主和 Webview。

### 2.3 Node 构建目标与 VS Code 最低版本未对齐

**位置：** `PLAN_v2.md` 第 26 行。

扩展运行于 VS Code 自带的 Extension Host Node，而不是开发机当前安装的 Node。计划指定 `target: node20`，但项目仍声明支持 VS Code `^1.88.0`，两者未进行兼容性验证。

**建议修改：**

- 根据最低支持的 VS Code 版本选择 esbuild target。
- 将 `@types/vscode` 固定到与 `engines.vscode` 对应的版本范围，避免使用新类型后在旧 VS Code 运行失败。
- 如果坚持使用 Node 20 能力，则同步提高 `engines.vscode` 并在该最低版本执行扩展测试。

### 2.4 Windows CLI 启动方案不完整

**位置：** `PLAN_v2.md` 第 104-112 行。

Windows 通过 npm 全局安装后，PATH 中常见入口是 `opencode.cmd`。对 `.cmd` 使用 `spawn(..., { shell: false })` 不能作为可靠方案。

**建议修改：**

1. 依次检查用户配置路径、`where.exe opencode` 和 PATH。
2. 如果解析结果为 `.exe`，直接使用 `spawn`。
3. 如果解析结果为 `.cmd`，使用固定的 `cmd.exe /d /s /c` 启动，并对每个参数执行严格转义。
4. 不允许把工作区路径、端口或用户输入拼成未经转义的命令字符串。
5. 错误信息需区分“未安装”“不在 PATH”“端口占用”“启动后健康检查失败”。

### 2.5 缺少 Workspace Trust 和真实安全边界

**位置：** `PLAN_v2.md` 第 155-166 行。

仅检查 Permission 中出现的文件路径，无法保证命令不会修改工作区外文件。例如获得 bash 权限的脚本可以间接访问任意路径。

**建议修改：**

- 在启动 CLI、发送 Craft 请求和批准执行权限前检查 `vscode.workspace.isTrusted`。
- 未信任工作区只允许浏览静态 UI，不允许自动启动服务或执行工具。
- 对明确包含目标路径的权限执行规范化和工作区边界校验。
- 默认拒绝外部目录权限。
- 在产品说明中明确：权限预批准不是操作系统级沙箱。
- 在 Stage -1 禁用现有 `parseDiffResponse`、`applyDiff` 和 Apply All 写入入口。

## 3. 高优先级问题

### 3.1 Plan 到 Craft 的 Session 策略会丢失上下文

**位置：** `PLAN_v2.md` 第 121-124 行。

计划建议切换 agent 时新建 Session。这样 Craft 无法自然获取同一会话中刚生成并确认的 Plan。

**建议：** 默认复用当前 Session，在后续 prompt 中切换 agent。只有用户明确要求隔离任务时才创建子 Session，并显式传递计划上下文。

### 3.2 Webview 共享类型方案缺少 Vite 配置和运行时校验

**位置：** `PLAN_v2.md` 第 43-48 行。

`tsconfig.paths` 只影响 TypeScript 模块解析，不会自动修改 Vite 的运行时解析。宿主与 Webview 间的数据也不能只靠 TypeScript 类型保证可信。

**建议：**

- 同时配置 Vite alias，或者使用稳定的相对导入路径。
- 共享 Message 联合类型和 payload schema。
- 对来自 Webview、SDK 事件及配置文件的数据执行 Zod 或等价 schema 校验。
- 未识别的消息类型记录日志并安全忽略，不应进入默认业务分支。

### 3.3 遗漏现有 Webview 重复请求问题

当前 `SkillsMcpPanel` 接收来自 App 的内联回调。如果 effect 将这些回调作为依赖，父组件重渲染后可能反复触发 Skills/MCP 列表请求。

**建议：** 在 Stage 0 使用 `useCallback` 固定处理函数，或让 effect 只依赖稳定的消息分发器，并增加“打开面板只请求一次”的组件测试。

### 3.4 当前计划批准逻辑可能覆盖根目录文件

现有实现可能将批准后的内容直接写入工作区根目录 `PLAN.md`。项目已经使用该文件保存总体计划，直接覆盖会造成数据丢失。

**建议：**

- 将“批准计划”和“保存为文件”拆成两个动作。
- 保存时弹出 `showSaveDialog`，默认使用不冲突的文件名。
- 覆盖已有文件前必须由用户明确确认。
- 不得用固定路径写入工作区根目录。

### 3.5 构建和打包脚本会重复执行

**位置：** `PLAN_v2.md` 第 35-38 行。

`package-vsix` 先执行 `npm run build`，而 `vsce package` 还会触发 `vscode:prepublish`，导致构建重复。`node esbuild.config.js --watch` 也只有在配置文件显式解析参数时才会启用 watch。

**建议：**

- 只让 `vscode:prepublish` 负责发布前构建。
- `package-vsix` 只执行 `vsce package` 和产物校验。
- 增加显式 `clean`，分别清理 `out/extension` 与 `out/webview`。
- esbuild 配置使用 `.mjs` 或 `.cjs` 明确模块类型，并显式实现 watch 分支。

### 3.6 Webview 资源白名单过宽

**位置：** `PLAN_v2.md` 第 67-71 行。

`out/extension` 不应加入 Webview 的 `localResourceRoots`，否则 Webview 可以请求扩展宿主 bundle。

**建议：** 仅允许 `out/webview`，并继续使用 nonce CSP 和 `webview.asWebviewUri`。

### 3.7 “仅 CLI”与 `serverUrl` 配置存在冲突

**位置：** `PLAN_v2.md` 第 8、103 行。

计划开头决定“只支持 CLI，由扩展管理启动”，后面又增加 `serverUrl`。两者对应不同连接模式，需要明确优先级和生命周期责任。

**建议决策：**

- 配置了 `serverUrl`：只连接外部服务，不管理其进程。
- 未配置 `serverUrl`：扩展查找并启动本机 CLI。
- 两种模式都通过 `/global/health` 验证连接。

## 4. 中优先级问题

### 4.1 文件 Part 需要按 SDK 类型验证

**位置：** `PLAN_v2.md` 第 174-180 行。

不能预设“传递本地路径，OpenCode 即可读取”。应先确认 SDK 的 `FilePart` 是否要求 URL、MIME、文件名或二进制内容，再决定使用 File Part、文本引用或 OpenCode 文件工具。

### 4.2 图片限制只有尺寸，没有消息体限制

**位置：** `PLAN_v2.md` 第 181-186 行。

`quality: 0.8` 对 PNG 通常没有预期效果。还应定义：

- 单张图片最大编码字节数。
- 单次消息的图片数量和总字节数。
- JPEG/WebP 转换策略。
- EXIF 方向修正。
- SVG、动图及无法解码文件的处理策略。

### 4.3 Skills 安装后的刷新语义未定义

**位置：** `PLAN_v2.md` 第 188-198 行。

复制 Skill 后，正在运行的 OpenCode 服务是否会自动加载尚未验证。计划应区分“已复制”“已发现”“已加载”，并根据服务能力实现刷新、重连或提示重启。

### 4.4 批量批准语义不明确

**位置：** `PLAN_v2.md` 第 164-166 行。

“SDK 支持时实现 Approve All”不能作为最终规格。批量批准可能无意中批准命令、外部目录或网络访问。

**建议：** 初版移除 Approve All；如果后续增加，只允许同类型、同作用域权限，并在确认框中列出准确影响范围。

### 4.5 测试安排过晚

**位置：** `PLAN_v2.md` 第 220-232 行。

关键测试集中在 Stage 4，会导致早期阶段积累难以定位的回归。

**建议：** 每个阶段同步增加测试门禁：

| 阶段 | 必须新增的验证 |
| --- | --- |
| Stage -1 | 路径边界、Workspace Trust、危险旧入口禁用 |
| Stage 0 | 宿主/Webview 类型检查、VSIX 文件清单 |
| Stage 1 | Windows CLI 解析、健康检查、SSE 取消与重连 |
| Stage 2 | 权限事件分发、Session 复用、拒绝流程 |
| Stage 3 | Skills/MCP schema、图片大小限制 |
| Stage 4 | VS Code 集成测试和发布回归 |

## 5. 文档状态问题

`PLAN_v2.md` 末尾声明保留 `PLAN.md` 和 `FIX_REPORT.md` 作为原始计划与审计报告，但审计时磁盘上的这两个文件均为 0 字节。

实施前需要确认：

- IDE 中是否存在未保存内容。
- 这两个文件是否仍作为后续实施依据。
- 是否应从版本控制或历史记录恢复。

在内容恢复前，不能把它们当作可追溯的需求基线。

## 6. 建议新增 Stage -1

### Stage -1：安全与契约确认

1. 安装并锁定计划使用的 `@opencode-ai/sdk` 版本。
2. 用 SDK 导出类型验证 Session、Prompt、Event、Permission、Provider 和 MCP 数据结构。
3. 编写最小连接验证：健康检查、创建 Session、发送 Plan prompt、消费事件、取消请求。
4. 明确同 Session 切换 agent 的策略。
5. 实现 Workspace Trust 门禁。
6. 禁用旧差异解析和直接写文件入口。
7. 确认 Windows 下 `.exe`、`.cmd` 和用户自定义 CLI 路径的启动方式。
8. 确认 `serverUrl` 外部连接模式与本机 CLI 托管模式的优先级。

**验收条件：**

- 所有 OpenCode 请求和事件类型来自锁定版本 SDK。
- Plan 到 Craft 可在同一 Session 中保留上下文。
- 未信任工作区无法启动 CLI、批准工具或写入文件。
- Windows 可正确发现并启动 CLI，也能连接用户配置的外部服务。
- 旧的 `applyDiff`、Apply All 和固定 `PLAN.md` 覆盖入口不可用。

## 7. 修订后的实施优先级

| 优先级 | 工作项 | 进入下一阶段的条件 |
| --- | --- | --- |
| P0 | Stage -1：SDK 契约、安全门禁、Windows CLI 验证 | 最小端到端调用通过 |
| P0 | 构建拆分和双端类型检查 | 可重复构建且产物互不覆盖 |
| P0 | Session、SSE 和 Permission 状态机 | Plan/Craft 上下文和权限流通过测试 |
| P1 | Provider/Model、文件、图片 | 数据来自 OpenCode，消息有大小边界 |
| P1 | Skills/MCP | schema 校验、刷新语义明确 |
| P1 | VSIX 集成测试 | 新安装后可激活、连接、对话和停止服务 |
| P2 | 依赖清理和文档完善 | 锁文件、VSIX 清单和使用说明一致 |

## 8. 实施前待确认决策

1. Plan 与 Craft 是否默认复用同一 Session。本审计建议复用。
2. `serverUrl` 是否保留。本审计建议保留，并作为外部服务优先模式。
3. 是否取消初版 Approve All。本审计建议取消。
4. Windows 首发是否只支持原生 CLI，还是同时声明支持 WSL/Remote Extension Host。
5. `PLAN.md` 和 `FIX_REPORT.md` 的真实内容从哪里恢复。

## 9. 最终意见

`PLAN_v2.md` 可以作为重构基础，但不建议直接进入当前 Stage 0。先补充 Stage -1，并修正 SDK 接口、构建类型检查、Windows CLI 启动、Workspace Trust、Session 复用和旧写入逻辑，之后再按阶段实施。这样可以避免在 UI 和功能层完成后，因底层连接模型或安全边界错误而返工。
