# OpenCode RainEye 修复计划 v2

> 基于 `PROJECT_AUDIT_AND_REPAIR.md` 与用户决策制定。  
> 版本：v2.0  
> 状态：待确认后执行  
> 关键决策：
> - Craft 审批：原生 permission 事前审批
> - OpenCode 连接：使用 CLI，扩展负责启动/托管
> - 模型配置：OpenCode 是唯一事实源
> - Extension 构建：esbuild 打包为单文件

---

## 阶段 0：恢复可运行交付物

目标：让 VSIX 能正常安装、激活并打开侧边栏。

### 0.1 Extension Host esbuild 打包

- 安装 `esbuild` 作为 devDependency。
- 新增 `esbuild.config.js`（或 inline npm script）：
  - entry: `src/extension.ts`
  - outdir: `out/extension`
  - format: `cjs`
  - platform: `node`
  - target: `node20`
  - external: `vscode`
  - bundle: `true`
- 更新 `package.json`：
  - `"main": "./out/extension/extension.js"`
  - scripts：
    - `build:extension`: `node esbuild.config.js`
    - `build:webview`: `vite build --config vite.config.mts`
    - `build`: `npm run build:extension && npm run build:webview`
    - `watch:extension`: `node esbuild.config.js --watch`
    - `vscode:prepublish`: `npm run build`
    - `package-vsix`: `npm run build && vsce package --no-dependencies --out out/opencode-raineye.vsix`
- 删除 `compile`、`compile:webview`、`watch` 旧脚本。
- 验证 VSIX 解包后 `out/extension/extension.js` 及 `out/webview/assets/*` 均存在。

### 0.2 Webview TypeScript 类型修复

- 统一消息协议来源：根目录 `src/shared/messages.ts`，Extension Host 与 Webview 共同引用。
- 在 `webview/tsconfig.json` 中正确配置 `paths` 指向共享类型。
- 修正以下类型错误：
  - `SkillInfoPayload`、`McpServerPayload` 导出。
  - Webview 发送消息联合类型补充 `file:pick`、`skills:list`、`skills:add`、`mcp:list`、`mcp:add`。
  - 增加 `acquireVsCodeApi` 全局声明。
- 新增 `typecheck:webview` script，并在 `build` 中前置执行。
- 删除 `webview/src/types/messages.js(.map)` 等源码中的生成文件。

### 0.3 Webview VS Code API 单例化

- `webview/src/hooks/useExtension.ts`：模块级只调用一次 `acquireVsCodeApi()`，缓存实例复用。
- 初始化时发送 `ready` 消息。
- Extension Host 处理 `ready` 消息：回复当前连接状态和模型列表。

### 0.4 View Container 与命令注册修正

- `package.json`：
  - 将 `views.explorer` 中的 `opencodeRaineye.sidebar` 移到 `views.opencodeRaineye`（与 `viewsContainers` 对应）。
  - `activationEvents` 保留 `onView:opencodeRaineye.sidebar` 和 `onCommand:opencodeRaineye.openSidebar`。
  - Activity Bar icon 改为真实 SVG 路径（`media/icon.svg`）。
- `src/commands/openSidebar.ts`：执行 `vscode.commands.executeCommand('opencodeRaineye.sidebar.focus')` 而不是仅 `provider.reveal()`。
- 注册 `manageProviders`、`manageSkillsMcp` 命令处理器（可先实现为占位提示）。

### 0.5 CSP 与资源根收紧

- `provider.ts` 每次生成随机 nonce。
- `localResourceRoots` 仅保留 `out/extension` 和 `out/webview/assets`。

### 阶段 0 验收

- `npm run typecheck:webview` 无错误。
- `npm run build` 成功。
- `npm run package-vsix` 成功，VSIX 解包后入口文件存在。
- Extension Development Host 中点击 Activity Bar 能打开侧边栏，控制台无异常。

---

## 阶段 1：接通 OpenCode 原生链路

目标：用官方 SDK 替代自制 OpenAI 兼容层，实现 session、event、provider、agent。

### 1.1 引入 OpenCode SDK

- 调研并安装官方 `@opencode-ai/sdk`（或对应 npm 包名以实际文档为准）。
- 封装 `src/opencode/sdkClient.ts`：
  - `createClient(baseUrl, password?)`
  - `health()` -> `GET /global/health`
  - `getPath()` -> `GET /path`（验证 workspace）
  - `listProviders()` -> `GET /provider` 或 `/config/providers`
  - `createSession(agent: 'plan' | 'build')` -> `POST /session`
  - `prompt(sessionId, parts)` -> `POST /session/:id/message` 或等效接口
  - `subscribeEvents(sessionId)` -> `GET /event` SSE
  - `getDiff(sessionId)` -> `GET /session/:id/diff`
  - `approvePermission(permissionId)` / `rejectPermission(permissionId)`

### 1.2 连接状态机

- 状态：`idle -> locating -> connecting | starting -> connected -> reconnecting -> error`
- `OpenCodeProcessManager` 改造：
  - 新增配置项 `opencodeRaineye.serverUrl`：若填写则直接连接。
  - 未填写时尝试从 `opencodeRaineye.command` 启动 CLI。
  - CLI 找不到时向用户展示诊断信息（提示安装 CLI 并提供设置入口）。
  - 启动时使用参数数组、`shell: false`。
  - 持续消费 stdout/stderr 并写入 Output Channel。
  - 连接后调用 `/global/health` 和 `/path` 验证身份与 workspace。
  - 支持取消启动、超时后重试。

### 1.3 Plan / Craft 映射到原生 Agent

- UI 标签保留 `Plan` / `Craft`。
- `Plan` -> `agent: "plan"`。
- `Craft` -> `agent: "build"`。
- 删除 system prompt 模拟方式。
- 每条用户消息发送为 OpenCode Part 数组（text、image、file）。

### 1.4 Session 上下文

- `OpenCodeSidebarProvider` 维护当前 `sessionId`。
- 新对话创建新 session。
- 切换 agent 模式时是否新建 session 需明确（推荐切换时新建，避免 plan/build 上下文混淆）。

### 阶段 1 验收

- Windows 上能启动 CLI 并连接 Server。
- 连续两轮聊天共享同一 session 上下文。
- Plan agent 不修改工作区。
- Build agent 产生操作后能通过 permission API 询问用户。

---

## 阶段 2：安全审批与变更应用

目标：实现 Craft/Build 模式下的原生 permission 审批。

### 2.1 Permission 事件处理

- Extension Host 监听 SDK event stream 中的 `permission` 事件。
- 向 Webview 发送 `permission:request` 消息，包含：
  - permissionId
  - 操作类型（edit / bash / etc.）
  - 文件路径或命令
  - 简要说明
- Webview 渲染 PermissionCard，提供 Approve / Reject。
- 用户决策后调用 SDK approve/reject API。

### 2.2 文件变更展示（可选增强）

- Build agent 执行后，调用 `session diff` 获取变更列表。
- 向 Webview 发送 `craft:diffList` 展示新增/修改/删除文件摘要。
- 此阶段 diff 仅展示，不额外审批（已通过 permission 事前审批）。

### 2.3 路径边界保护

- 所有 Build agent 修改的目标路径必须位于当前 workspace 内。
- 对路径执行 `path.resolve` + `realpath` 检查。
- 越界路径的 permission 自动拒绝并提示用户。

### 阶段 2 验收

- Build agent 修改文件前弹出审批卡片。
- 拒绝后该操作不执行。
- 批准的修改发生在 workspace 内。
- Approve All / Reject All 行为真实有效（如果 SDK 支持批量）。

---

## 阶段 3：附件、渲染、Skills/MCP

### 3.1 文件引用 `@`

- 实现输入框中 `@` 自动补全，使用 `vscode.workspace.findFiles`。
- 限制为 workspace 内文件，跳过二进制和敏感文件。
- 附件状态统一在 App 层管理，显示在输入框内并支持移除。
- 使用共享 token 预算，而不是每个文件独立预算。
- 大文件通过 SDK file Part 引用路径，让 OpenCode agent 自己读取。

### 3.2 图片输入

- Webview 保留选择/粘贴流程。
- 发送前按最长边 1536px、quality 0.8、单图大小上限压缩。
- 根据 OpenCode provider 返回的模型能力决定是否允许图片。
- 使用 SDK 原生 image Part 类型，不再硬编码 OpenAI `image_url`。
- 清理临时文件。

### 3.3 Skills

- 校验目录中存在合法 `SKILL.md`。
- 复制前显示目标路径和覆盖确认。
- 支持移除、打开目录。
- 区分项目级/用户级目标选择。

### 3.4 MCP

- 优先使用 Server `GET/POST /mcp`。
- CLI 作为 fallback，使用 `execFile` 参数数组，禁止 shell 字符串拼接。
- 修复 `sse` 分支未传 URL 的问题。
- 对 transport schema 做运行时校验。

### 3.5 消息渲染

- 渲染 OpenCode 结构化 message parts：text、tool、file、reasoning、question、permission、error。
- 使用可靠 Markdown 渲染器并做 HTML sanitize。
- 命令卡片显示命令、状态、退出码和截断后的 stdout/stderr。
- 增加停止生成、重试、自动滚动。
- 增加 React Error Boundary。

---

## 阶段 4：Manifest、测试与发布

### 4.1 Manifest 清理

- `.vscodeignore` 仅允许发布运行时必需文件、README、LICENSE、图标。
- 删除 VSIX 中的 `FIX_REPORT.md`、`.codebuddy/plans`、`out/.vscode` 等非运行时文件。
- 补充真实 `repository`、`publisher`、README、`CHANGELOG.md`、图标。

### 4.2 测试

- 单元测试：路径边界、文件预算、change set、事件归一化、CLI 定位。
- 合约测试：mock server 验证 SDK/API 错误和事件顺序。
- 集成测试：启动真实 OpenCode Server 执行 Plan/Build。
- VS Code E2E：激活、打开 view、发送消息、审批、重载恢复。

### 4.3 发布冒烟

- 在干净 Extension Host 中安装 VSIX，完成一轮 Plan/Build 核心流程。

---

## 阶段执行顺序

1. 阶段 0（必须先完成，否则后续无法验证）
2. 阶段 1
3. 阶段 2
4. 阶段 3
5. 阶段 4

---

## 当前状态

- `PLAN.md` 为原始实现计划。
- `PLAN_v2.md` 为本次修复计划（本文档）。
- `FIX_REPORT.md` 为问题分析报告。

下一步：确认本计划后，开始执行阶段 0。
