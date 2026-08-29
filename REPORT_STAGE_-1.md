# Stage -1 接口兼容性与安全基线报告

> 生成时间：2026-08-28  
> SDK 版本：`@opencode-ai/sdk@1.18.25`  
> 状态：Extension Host 类型检查通过；smoke test 已运行，事件流消费方式已修正。

---

## 1. SDK 接口确认

| 接口 | 方法签名 | 用途 | 状态 |
|------|----------|------|------|
| 创建 Client | `createOpencodeClient({ baseUrl, directory })` | 连接 OpenCode Server | ✅ |
| 工作区验证 | `client.path.get({ query: { directory } })` | health / workspace 校验 | ✅ |
| 创建 Session | `client.session.create({ body: { title, parentID } })` | 新建对话 | ✅ |
| 发送 Prompt | `client.session.prompt({ path: { id }, body: { agent, model, system, parts } })` | 发送用户消息 | ✅ |
| 异步 Prompt | `client.session.promptAsync({ ... })` | 异步发送 | ✅ |
| 响应权限 | `client.postSessionIdPermissionsPermissionId({ path: { id, permissionID }, body: { response } })` | Approve/Reject | ✅ |
| 事件订阅 | `client.global.event()` -> `result.stream` | SSE 事件流 | ✅ |
| Provider 列表 | `client.config.providers()` | 获取可用模型/Key 配置 | ✅ |
| Agent 列表 | `client.app.agents()` | 获取可用 agents | ✅ |

**结论**：SDK v1.18.25 提供了 `session`、`permission`、`global.event`、`provider`、`app.agents` 等完整接口，满足原生 Plan/Craft 接入需求。

---

## 2. 已知 SDK 行为与注意事项（已实测）

1. **ESM 模块**
   - `@opencode-ai/sdk` 是 ESM 包。
   - Extension Host 当前为 CommonJS，使用 `await import('@opencode-ai/sdk')` 进行动态导入。
   - Stage 0 引入 esbuild 后，打包时会将 ESM 依赖转换为 CJS 单文件，无需运行时 `import()`。

2. **事件流消费**
   - `client.global.event()` 返回 `ServerSentEventsResult`，实际可用字段为 `result.stream`（部分版本可能为 `result.data?.stream`）。
   - 消费方式：`for await (const event of result.stream)`。
   - 取消时通过 `AbortSignal` 或 `break` + `stream.return()`。

3. **Permission 响应字段大小写**
   - path 参数为 `{ id: sessionId, permissionID: permissionId }`（permissionID 全大写）。
   - response 取值为 `'once' | 'always' | 'reject'`。

4. **Provider 数据结构**
   - 应使用 `client.config.providers()`，返回 `{ providers: Provider[], default: Record<string, string> }`。
   - Provider 对象包含 `id`, `name`, `source`, `env`, `key`, `options`, `models`。
   - 插件 UI 应使用 `providers` 列表，并用 `default` 标记默认模型。

5. **Agent 名称映射**
   - `app.agents()` 返回完整 agent 对象数组，包含 `name`, `description`, `mode`, `native`, `permission` 等。
   - 实测可用 agents：`build`, `compaction`, `explore`, `general`, `plan`, `summary`, `title`。
   - UI 标签 `Plan` 映射为 agent `"plan"`。
   - UI 标签 `Craft` 映射为 agent `"build"`。

6. **Path 验证**
   - `client.path.get({ query: { directory } })` 返回 `{ home, state, config, worktree, directory }`。
   - 即使 `worktree` 为 `/`，只要 `directory` 与当前路径匹配即可视为验证通过。

---

## 3. Stage -1 已完成的代码改动

1. **安装并锁定 SDK**
   - `package.json` 依赖 `@opencode-ai/sdk@1.18.25`。

2. **新增 SDK 封装**
   - `src/opencode/sdkTypes.ts`：类型重导出（使用 `resolution-mode: 'import'` 兼容 CJS）。
   - `src/opencode/sdkClient.ts`：`OpenCodeSdkClient`，封装连接、Session、Prompt、Permission、事件流、Provider/Agent 查询。

3. **Workspace Trust 安全门禁**
   - `src/utils/workspaceTrust.ts`：`requireWorkspaceTrust(action)`。
   - `src/extension.ts`：未信任工作区跳过 auto-connect 并提示用户。
   - `src/webview/provider.ts`：发送消息、审批、添加 Skill/MCP 前均检查 trust。

4. **下线危险旧入口**
   - `src/files/diffManager.ts`：`applyDiff` 直接抛错。
   - `src/webview/provider.ts`：`_handlePlanApprove`、`_handleApplyDiff`、`_handleApplyAll` 不再写文件，仅提示用户。

5. **Windows CLI 启动预研**
   - `src/opencode/processManager.ts`：
     - 新增 `_resolveOpenCodeCommand` 解析 `.exe` / `.cmd` / `.bat` / 绝对路径 / PATH。
     - Windows `.cmd/.bat` 使用 `cmd.exe /d /s /c` 启动。
     - 默认 `shell: false` 传数组参数。
     - 保留自定义命令配置 `opencodeRaineye.command`。

6. **修复既有 P0 缺陷**
   - `src/webview/provider.ts`：
     - CSP nonce 随机化。
     - 流式结束不再重复追加完整回复。

7. **新增最小验证脚本**
   - `scripts/sdk-smoke-test.mjs`：验证 path、providers、agents、session、prompt、event。

---

## 4. 类型检查结果

- `npx tsc --noEmit`：通过 ✅
- `npx tsc -p webview/tsconfig.json --noEmit`：存在配置引用问题，计划在 Stage 0 修复。

---

## 5. 遗留风险与 Stage 0 入口

1. **SDK 运行验证已部分完成**
   - smoke test 已验证 path、providers、agents、session、prompt。
   - 事件流消费方式已修正，建议再次运行确认 5s 内能收到 event。

2. **ESM 动态导入在运行时可能失败**
   - Extension Host 是 CJS，`await import('@opencode-ai/sdk')` 在 Node 20 中支持，但需在打包后验证。

3. **Windows CLI 启动未实测**
   - `_resolveOpenCodeCommand` 逻辑已写，但未在真实 Windows 环境 + `.cmd` 文件下测试。

4. **Webview 类型与构建问题**
   - 当前 Webview 构建仍使用旧 vite 配置，Stage 0 统一重构。

---

## 6. Stage 0 开始前建议

1. 运行 `node scripts/sdk-smoke-test.mjs` 验证 SDK 接口契约。
2. 确认 OpenCode CLI 安装路径，测试 `opencodeRaineye.command` 配置。
3. 如果 smoke test 通过，进入 Stage 0：esbuild 打包 + Webview 类型修复 + View Container 修正。
