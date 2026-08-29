# OpenCode RainEye 修复计划 v3

> 基于 `planv2审计文档.md` 修订。  
> 状态：待用户确认 3 项决策后执行。  
> 默认策略：优先复用审计建议。

---

## 关键变更

- 在 `PLAN_v2.md` 的 Stage 0 之前新增 **Stage -1：安全与 API 契约确认**。
- SDK 接口直接复用 `@opencode-ai/sdk` 导出类型，不再手工维护近似类型。
- esbuild 打包保留，但同步增加 Extension Host 类型检查 `typecheck:extension`。
- Windows CLI 启动区分 `.exe` / `.cmd`，分别使用 `spawn` / `cmd.exe /d /s /c`。
- 默认 Plan/Craft 复用同一 Session。
- `serverUrl` 保留，外部连接模式优先；未配置时扩展启动本机 CLI。
- 初版取消 Approve All，只支持逐条审批。
- 旧 `applyDiff`、Apply All、固定 `PLAN.md` 写入入口在 Stage -1 下线。

---

## 待确认决策

| 编号 | 决策 | 审计建议 | 默认选择 |
|------|------|----------|----------|
| D1 | Plan/Craft 是否默认复用同一 Session | 复用 | 复用 |
| D2 | 是否保留 `serverUrl` 外部连接模式 | 保留，且优先于 CLI 启动 | 保留 |
| D3 | 初版是否取消 Approve All | 取消 | 取消 |

请确认是否接受上述默认选择，或需要调整。

---

## 实施阶段

### Stage -1：安全与 API 契约确认

目标：锁定 OpenCode SDK 版本、确认接口契约、下线危险旧入口、建立安全门禁。

1. **SDK 安装与类型锁定**
   - 安装并锁定 `@opencode-ai/sdk` 版本。
   - 从 SDK 导出 `Session`、`PromptPart`、`OpenCodeEvent`、`PermissionResponse`、`ModelRef`、`Provider` 等类型。
   - 确认最小可运行接口：
     ```ts
     createSession(input?: { title?: string; parentID?: string }): Promise<Session>
     prompt(sessionId: string, input: { agent?: string; model?: ModelRef; parts: PromptPart[] }): Promise<void>
     subscribeEvents(signal: AbortSignal): AsyncIterable<OpenCodeEvent>
     respondPermission(sessionId: string, permissionId: string, response: PermissionResponse): Promise<void>
     ```

2. **最小连接验证**
   - 编写独立脚本：健康检查 `/global/health`、创建 Session、发送 Plan prompt、消费事件、取消请求。
   - 验证同 Session 切换 agent 后上下文保留。
   - 输出接口兼容性报告。

3. **Workspace Trust 门禁**
   - 在以下入口检查 `vscode.workspace.isTrusted`：
     - 自动/手动启动 CLI
     - 发送 Plan/Craft prompt
     - 批准任何权限
     - 写入工作区文件
   - 未信任工作区只允许浏览静态 UI。

4. **旧危险入口下线**
   - 禁用 `parseDiffResponse`。
   - 禁用 `applyDiff` 直接写文件。
   - 禁用 Apply All。
   - 禁止固定路径写入 `PLAN.md`；"保存计划"改为 `showSaveDialog`。

5. **Windows CLI 启动预研**
   - 确认 CLI 安装形态：`.exe`、`.cmd`、用户自定义路径。
   - 验证 `spawn` 和 `cmd.exe /d /s /c` 启动方式。
   - 错误分类：未安装 / 不在 PATH / 端口占用 / 健康检查失败。

**验收条件：**
- 所有 OpenCode 类型来自锁定版本 SDK。
- 同 Session Plan -> Craft 上下文保留。
- 未信任工作区无法启动 CLI、发送消息或写入文件。
- Windows 能正确启动 `.exe` 和 `.cmd` 形态 CLI。
- 旧的 diff 应用和固定 PLAN.md 写入入口不可用。

---

### Stage 0：构建拆分与双端类型检查

目标：Extension Host 与 Webview 输出目录隔离，双端类型检查通过，VSIX 可重复构建。

1. **esbuild 打包 Extension Host**
   - 安装 `esbuild`。
   - 新增 `esbuild.config.mjs`：
     - entry: `src/extension.ts`
     - outdir: `out/extension`
     - format: `cjs`
     - platform: `node`
     - target: 与 `engines.vscode` 对应
     - external: `vscode`
     - bundle: `true`
   - 增加显式 `--watch` 分支。

2. **脚本重构**
   ```json
   {
     "clean": "rimraf out/extension out/webview out/opencode-raineye.vsix",
     "typecheck:extension": "tsc -p tsconfig.json --noEmit",
     "typecheck:webview": "tsc -p webview/tsconfig.json --noEmit",
     "typecheck": "npm run typecheck:extension && npm run typecheck:webview",
     "build:extension": "node esbuild.config.mjs",
     "build:webview": "vite build --config vite.config.mts",
     "build": "npm run clean && npm run typecheck && npm run build:extension && npm run build:webview",
     "watch:extension": "node esbuild.config.mjs --watch",
     "vscode:prepublish": "npm run build",
     "package-vsix": "vsce package --no-dependencies --out out/opencode-raineye.vsix",
     "verify-vsix": "node scripts/verify-vsix.js"
   }
   ```

3. **共享类型与 Vite alias**
   - 共享消息协议位于 `src/shared/messages.ts`。
   - Webview 通过稳定相对路径或 Vite alias 引用共享类型。
   - 引入 Zod 对 Webview <-> Extension Host 消息做运行时校验。

4. **package.json 修正**
   - `"main": "./out/extension/extension.js"`
   - `activationEvents` 包含 `onView:opencodeRaineye.sidebar` 和 `onCommand:opencodeRaineye.openSidebar`
   - views 配置到 `views.opencodeRaineye`，而非 `views.explorer`
   - Activity Bar icon 使用真实 `media/icon.svg`

5. **Webview 单例与资源白名单**
   - `acquireVsCodeApi()` 模块级单例。
   - `localResourceRoots` 仅允许 `out/webview`。
   - 随机 nonce CSP。

6. **View Container 与命令**
   - `openSidebar` 命令执行 `vscode.commands.executeCommand('opencodeRaineye.sidebar.focus')`。
   - 注册 `manageProviders`、`manageSkillsMcp` 命令（可占位）。

**验收条件：**
- `npm run typecheck` 无错误。
- `npm run build` 成功。
- `npm run package-vsix` 成功，且不重复构建。
- VSIX 解包后入口文件和 webview 资源均存在。
- Extension Host 中点击 Activity Bar 能打开侧边栏。

---

### Stage 1：OpenCode 原生链路

目标：用官方 SDK 替代自制 OpenAI 兼容层。

1. **SDK Client 封装**
   - `src/opencode/sdkClient.ts` 封装：health、path、createSession、prompt、subscribeEvents、respondPermission、listProviders、listModels。
   - 统一错误分类：网络、认证、超时、取消。

2. **连接管理器**
   - 状态机：`idle -> locating -> starting -> connecting -> connected -> reconnecting -> error`。
   - 配置项：
     - `opencodeRaineye.serverUrl`：外部服务 URL（优先）
     - `opencodeRaineye.command`：自定义 CLI 路径
     - `opencodeRaineye.port`：CLI 启动端口（默认 6688）
   - 未配置 `serverUrl` 时：查找并启动 CLI。
   - 启动参数使用数组，禁止 shell 字符串拼接。
   - stdout/stderr 持续写入 Output Channel。

3. **Session 与 Prompt**
   - 默认 Plan/Craft 复用当前 Session。
   - 用户主动新建对话时才创建新 Session。
   - 切换 agent 通过 prompt 的 `agent` 字段实现。

4. **SSE 事件分发**
   - 单条共享 SSE 连接。
   - 按 `sessionID`、`messageID` 分发事件到对应 UI 状态。
   - 支持 `AbortSignal` 取消。

**验收条件：**
- 能连接 SDK 并创建 Session。
- Plan prompt 返回事件流。
- 取消请求不抛未处理异常。
- Windows CLI 启动成功。

---

### Stage 2：权限审批与 Session 状态机

目标：实现原生 permission 事前审批。

1. **Permission 事件处理**
   - 监听 `permission` 事件。
   - 向 Webview 发送 `permission:request`，包含：
     - sessionId
     - permissionId
     - 操作类型
     - 目标路径/命令
     - 说明

2. **逐条审批 UI**
   - 渲染 PermissionCard。
   - Approve / Reject 调用 `respondPermission(sessionId, permissionId, response)`。
   - 初版不支持 Approve All。

3. **路径边界校验**
   - 对包含目标路径的权限执行 `path.resolve` + `realpath` 检查。
   - 目标必须在当前 workspace 内，否则自动拒绝。
   - 默认拒绝外部目录、网络访问等未明确授权的操作。

4. **Session 状态持久化**
   - 重载后恢复当前 sessionId（可选）。
   - 断开重连后继续消费事件。

**验收条件：**
- Build agent 修改文件前弹出审批卡片。
- 拒绝后操作不执行。
- 越界路径自动拒绝并提示。

---

### Stage 3：Provider/Model、附件、Skills/MCP

1. **Provider/Model**
   - 从 OpenCode 拉取 provider/model 列表作为唯一事实源。
   - UI 模型选择器使用 OpenCode 返回数据。
   - API Key 配置引导到 OpenCode auth API 或 CLI。

2. **文件引用 `@`**
   - 输入框 `@` 自动补全 workspace 文件。
   - 限制为项目内文件，跳过二进制。
   - 附件统一在 App 层管理，支持移除。
   - 大文件通过 SDK File Part 或路径引用。

3. **图片输入**
   - 压缩：最长边 1536px、单图字节上限、格式转换策略。
   - 根据模型能力判断是否允许图片。
   - 使用 SDK 原生 image Part。
   - 清理临时文件。

4. **Skills**
   - 校验 `SKILL.md` 存在。
   - 复制前显示目标路径和覆盖确认。
   - 安装后刷新 OpenCode 服务状态或提示重启。

5. **MCP**
   - 优先 Server HTTP API `/mcp`。
   - CLI fallback 使用 `execFile` 数组参数。
   - transport schema 校验。

6. **消息渲染**
   - 渲染 text/tool/file/reasoning/question/permission/error 等 parts。
   - Markdown sanitize。
   - 命令卡片显示命令、退出码、截断输出。
   - 停止生成、重试、自动滚动、Error Boundary。

---

### Stage 4：测试、清单与发布

1. **阶段同步测试**
   - Stage -1：路径边界、Workspace Trust、旧入口禁用。
   - Stage 0：类型检查、VSIX 清单。
   - Stage 1：Windows CLI、健康检查、SSE 重连。
   - Stage 2：权限分发、Session 复用、拒绝流程。
   - Stage 3：Skills/MCP schema、图片限制。
   - Stage 4：VS Code 集成测试、发布回归。

2. **VSIX 清单**
   - `.vscodeignore` 仅包含运行时必需文件、README、LICENSE、图标。
   - 删除非运行时文件（审计报告、计划文档等）从发布包。
   - 补充真实 `publisher`、`repository`、`CHANGELOG.md`。

3. **发布冒烟**
   - 干净 Extension Host 安装 VSIX。
   - 完成激活 -> 连接 -> 对话 -> 审批 -> 停止服务。

---

## 文档与基线

- `PLAN.md`：原始实现计划。
- `PLAN_v2.md`：基于审计的第一次修订。
- `PLAN_v3.md`：本文件，当前执行基线。
- `FIX_REPORT.md`：问题分析报告（需恢复为可阅读内容）。

---

## 下一步

请确认 D1/D2/D3 决策，确认后立即开始 Stage -1。
