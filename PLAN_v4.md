# OpenCode RainEye 修复与界面重构计划 v4

> 审计日期：2026-08-28  
> 执行原则：先跑通真实模型和事件流，再做界面重构；每个阶段独立验收，不用 UI 假数据掩盖后端问题。  
> 当前基线：`@opencode-ai/sdk@1.18.25`、本机 OpenCode Server `1.18.25`、Windows、VS Code 侧边栏 Webview。

## 1. 本轮目标

按优先级完成以下目标：

1. `P0`：修复 Hy3 Free 请求一直停留在 `OpenCode is thinking...` 的问题，确保文本、工具、错误、权限和结束状态都能可靠回传。
2. `P1`：重构为接近 CodeBuddy 工作流的侧边栏界面，解决窄侧边栏下控件和消息显示不完整的问题。
3. `P1`：支持新增对话、历史对话、切换和恢复 OpenCode Session。
4. `P1`：重构输入区，支持上边缘拖拽调整高度、上方文件/图片附件区、下方 Plan/Craft、模型和 Skill 选择。
5. `P2`：完善设置页，并在设置中完成 MCP 的新增、查看、状态展示、编辑、启停和删除。
6. `P2`：补齐 OpenCode 结构化输出，包括工具调用、问题、权限、推理、错误和文件变更。

## 2. 已核验的当前状态

### 2.1 已经跑通的部分

- `127.0.0.1:6688` 有真实 OpenCode Server 在监听。
- 插件能读取 Provider 和模型列表，`Hy3 Free` 的真实模型引用为 `opencode:hy3-free`。
- 使用仓库内 SDK 直接创建 Session 成功。
- 最小请求能够触发 Hy3 Free 生成，说明模型认证和 OpenCode Provider 本身可用。
- 当前 VSIX 构建、Extension Host 打包和 Webview 构建已有可用基线。

因此，当前首要故障不在 Hy3 Free 模型，而在插件的事件消费和请求状态管理。

### 2.2 “一直 thinking”的直接根因

#### 根因 A：首个全局事件导致消费循环崩溃

真实事件流连接后首先返回：

```json
{
  "payload": {
    "type": "server.connected",
    "properties": {}
  }
}
```

该事件没有 `directory`。`src/webview/provider.ts` 在处理任何事件前执行 `_matchesWorkspace(event.directory)`，而 `_matchesWorkspace()` 直接把该值传给 `path.resolve()`。运行时因此抛异常，随后 `_consumeEvents()` 进入重连，新的连接又收到同样事件并再次失败。

影响：

- 插件永远收不到当前 Session 的后续消息。
- Webview 已把 `isLoading` 设为 `true`，但收不到 `done`，所以一直显示 thinking。
- 失败重连会留下大量到 `6688` 的连接，存在句柄和连接泄漏风险。

#### 根因 B：当前实现忽略真实文本增量事件

本机 Server 的真实增量事件为：

```json
{
  "directory": "E:\\opencode_raineye",
  "payload": {
    "type": "message.part.delta",
    "properties": {
      "sessionID": "...",
      "messageID": "...",
      "partID": "...",
      "field": "text",
      "delta": "..."
    }
  }
}
```

当前代码只处理 `message.part.updated`，不处理 `message.part.delta`。即使修复根因 A，模型生成的增量文本仍不会显示。

#### 根因 C：SDK 类型入口与运行时事件契约不一致

当前代码从 `@opencode-ai/sdk` 主入口导入旧的 `GlobalEvent` 类型；同一个已安装包的 `@opencode-ai/sdk/v2` 类型才包含 `message.part.delta`、新的 Permission/Question 事件和更多结构化事件。静态类型没有暴露运行时差异，导致当前实现能够编译，但行为错误。

#### 根因 D：没有事件丢失后的恢复路径

当前请求只有一个 `_activeRequest` 和 Webview `isLoading` 布尔值：

- 发送前没有等待事件流真正 ready。
- SSE 断开后不根据 Session 状态或 Session Messages 补偿。
- 没有首事件超时、无进展提示、最终消息对账和失败重试。
- `status` 或非 `session.error` 异常不会保证清除 loading。

任何一次竞态、断流或未知事件都可能把界面永久留在 loading 状态。

### 2.3 当前界面与目标的差距

- 顶栏同时放标题、模型、模式和设置，在约 350px 的侧边栏中会被裁切。
- Header 和 Footer 使用 `position: fixed`，消息区只预留固定 `pb-24`；附件增加或输入框变高时会遮挡消息。
- 输入框不可拖拽调整高度。
- 文件和图片按钮位于输入框内部，附件标签显示在输入框下方，不符合目标布局。
- 文件选择只有系统对话框，没有输入 `@` 后的工作区文件搜索和补全。
- 模型和模式位于顶栏，Skill 没有会话级选择器。
- 只有一个持久化的 Session ID，没有“新增对话”和“历史对话”界面。
- 设置页只实现了 Skills/MCP 的部分新增和列表；MCP 列表把 `status` 错当作 `transport` 展示，也没有编辑、启停和删除。
- 只渲染文本，工具执行、推理、问题、文件变更等结构化 Part 没有进入 UI。

## 3. 推荐架构

```text
OpenCode Server
  -> OpenCodeSdkClient
  -> EventStreamManager（连接、ready、重连、释放）
  -> OpenCodeEventAdapter（运行时校验、兼容、去重）
  -> SessionController（请求状态、消息对账、取消、恢复）
  -> typed Extension <-> Webview messages
  -> React session store
  -> Header / History / MessageList / Composer / Settings
```

关键约束：

- Webview 不直接理解 OpenCode 原始事件，只消费插件内部稳定事件。
- Server Session 是会话和消息的唯一事实源，Webview 状态只是缓存。
- 单条未知事件不能终止整个 SSE 循环。
- 每次请求必须有 `requestId + sessionId`，不能用“最后一个 assistant 消息”猜测归属。
- 请求终态必须统一为 `completed | failed | cancelled | timed_out`，所有终态都清理 loading。

## 4. 实施阶段

### Stage 0：模型链路修复，最高优先级

#### 0.1 建立真实事件契约夹具

- 将本机 `1.18.25` 事件脱敏后保存为测试 fixture。
- 覆盖 `server.connected`、`message.updated`、`message.part.updated`、`message.part.delta`、`session.status`、`session.idle`、`session.error`、Permission 和 Tool Part。
- 对 `sync` 包装事件确定策略：首版忽略同步副本，只消费直接事件；后续需要同步恢复时再单独接入。
- 按事件 `id` 去重，避免同一更新被直接事件和同步事件重复渲染。

#### 0.2 修复 EventStreamManager

- 允许无 `directory` 的全局事件；`server.connected` 用来完成 ready 握手，不进入工作区消息分发。
- `_matchesWorkspace()` 接受 `unknown`，只对合法非空字符串做规范化。
- 把“连接错误”和“单个事件处理错误”分开；事件解析失败记录脱敏摘要后继续消费。
- 每次重连使用独立 `AbortController`，重连前明确 abort 并等待旧循环结束。
- 修复 iterator 提前退出时的 reader/HTTP 连接释放，验证不再持续增加到 `6688` 的连接。
- 发送 Prompt 前等待 SSE ready；超时后显示明确连接错误，不进入假 loading。

#### 0.3 新增 OpenCodeEventAdapter

- 使用运行时 schema 校验原始事件，不再完全信任生成的 TypeScript 类型。
- 支持当前 `message.part.delta`，仅在 `field === "text"` 时追加到对应 Part。
- 兼容旧 `message.part.updated` 快照，按 `partID` 替换或计算差量。
- 兼容当前和旧版 Permission/Question 事件名；所有兼容逻辑集中在 adapter。
- 将 text、reasoning、tool、file、step、permission、question、error 归一化为插件内部事件。

#### 0.4 建立可靠请求状态机

状态建议：

```text
idle -> submitting -> running
running -> awaiting_permission | reconnecting
running -> completed | failed | cancelled | timed_out
```

- `chat:send` 成功后回传 `chat:accepted { requestId, sessionId }`。
- 收到 `session.status=busy/retry` 时更新可见状态，不再只有通用 thinking 文案。
- 收到 `session.idle` 后调用 `session.messages` 做最终对账，再发送完成事件。
- SSE 断开但 Session 仍 busy 时重连；Session 已 idle 时直接拉取最终消息。
- 用户取消、Prompt API 报错、Event Loop 报错和 Webview 销毁都必须进入明确终态。
- 增加“长时间无事件”看门狗：先对账 Session 状态，不直接判定模型失败。

#### 0.5 修复模型与诊断行为

- 发送前校验选中的 `providerID/modelID` 确实存在；不存在时禁止发送并提示刷新模型。
- 持久化每个工作区最后选择的模型，不静默切到排序后的第一个模型。
- 输出日志包含 server URL、SDK/Server 版本、sessionId、requestId、事件类型和状态迁移，但不记录 Prompt 正文、附件内容、API Key 或 Authorization。
- 修复 `scripts/sdk-smoke-test.mjs`：使用 `promptAsync`，并行等待 `session.idle`，在 `finally` 中 abort/关闭事件流。
- Provider 响应必须脱敏；当前脚本会打印包含 `key` 的原始响应，必须立即移除。

#### Stage 0 验收

1. 在 VSIX 中选择 Hy3 Free，发送“只回复 OK”，能够看到增量或最终文本，并在完成后停止 loading。
2. 连续发送 10 轮消息，全部复用同一 Session 且上下文正确。
3. Craft 模式执行一次只读工具，工具状态和最终文本均可见。
4. 拒绝一次 Permission 后请求继续或明确结束，界面不残留 thinking。
5. SSE 人为断开后能够重连并通过 Session Messages 恢复结果。
6. 连续打开/关闭侧边栏和发送请求后，到 `6688` 的连接数量稳定，不持续增长。
7. 日志和测试输出中不存在 Provider Key、Token 或 Prompt 附件内容。

未通过上述 7 项前，不开始大规模 UI 重构。

### Stage 1：会话外壳与布局重构

#### 1.1 顶部会话栏

- 左侧显示产品名或当前会话标题，文本必须截断而不是撑宽容器。
- 右侧使用 Lucide 图标按钮：`Plus` 新增对话、`History` 历史对话、`Settings` 设置。
- 顶栏不再放模型和 Plan/Craft 选择器。
- 图标按钮提供 tooltip，并固定尺寸，确保 260px 到 600px 宽度均不溢出。

#### 1.2 页面布局

- 根节点改为 `grid` 或普通纵向 `flex`：Header、MessageViewport、Composer 自然参与布局。
- 移除 fixed Header/Footer 和固定 `pb-24`。
- 消息区使用 `min-height: 0; min-width: 0; overflow: auto`。
- Composer 高度变化时由布局自动挤压消息区，不手工计算 padding。
- 长路径、长命令和代码块在自身区域滚动或换行，不能撑破侧边栏。

#### 1.3 可拉伸 Composer

- Composer 上边缘增加高度 6px 左右的拖拽手柄，使用 Pointer Events 和 pointer capture。
- 建议高度范围：最小 132px；最大为侧边栏可用高度的 60%，同时保留消息区最小高度。
- 双击手柄恢复默认高度；高度写入 Webview state。
- 键盘可访问：手柄获得焦点后用方向键微调高度。

#### 1.4 Composer 内部结构

```text
Resize handle
Attachment shelf: @file chips + image thumbnails
Quick actions: @ file / image
Textarea
Bottom bar: Craft|Plan / Model / Skill / Send|Stop
```

- 文件和图片统一显示在输入框上方的 attachment shelf，可单独移除。
- 图片显示缩略图、文件名和大小；文件显示相对工作区路径。
- 底部选择器均支持窄宽度截断，不互相挤出屏幕。
- Send/Stop 使用熟悉图标，保持稳定尺寸。

#### Stage 1 验收

- 在 260px、350px、480px 三种侧边栏宽度下无横向页面滚动和控件裁切。
- Composer 从最小拖到最大高度时消息区仍可用，附件和底部选择器始终可见。
- 输入 20 行文本、附加 8 张图和 20 个文件时布局不重叠。
- 深色、浅色和高对比度 VS Code 主题下均可读。

### Stage 2：新增对话与历史对话

#### 2.1 SDK 能力

- 增加 `session.list`、`session.messages`、`session.update` 和 `session.delete` 封装。
- 会话列表按当前 workspace/directory 过滤，不混入其他项目。
- 消息加载直接使用 OpenCode 的 `info + parts`，经 EventAdapter 转为 UI 模型。

#### 2.2 交互

- 点击新增按钮立即创建或切换到空 Session；当前生成中时先确认是否停止。
- 历史面板支持列表、搜索、切换、删除，展示标题和更新时间。
- 切换会话时恢复消息、选用模型、Agent 模式和未决 Permission 状态。
- 当前 Session ID 继续存入 `workspaceState`，Webview 重载后从 Server 恢复消息。
- 新对话首条消息后同步 OpenCode 自动生成或更新的标题。

#### Stage 2 验收

- 新建 3 个会话后能从历史列表分别打开，上下文互不串线。
- Reload Window 后当前会话和消息完整恢复。
- 删除历史会话前有确认，删除后不能再被恢复为当前会话。
- 切换会话不会把旧请求的事件追加到新会话。

### Stage 3：`@` 文件、图片、模型和 Skill

#### 3.1 `@` 文件引用

- 输入 `@` 弹出工作区文件搜索浮层，支持键盘选择、模糊过滤和最近文件。
- Extension Host 使用 `vscode.workspace.findFiles`，排除 `.git`、`node_modules`、`out` 和常见二进制文件。
- 选中后生成结构化附件对象，不把绝对路径混进文本输入。
- 发送时继续执行真实路径、符号链接和 workspace boundary 校验。

#### 3.2 图片附件

- 保留现有压缩和数量限制，附件 shelf 显示缩略图。
- 在选择前后都校验模型图片能力；切换到不支持图片的模型时明确提示处理已有图片。
- 不在日志或 Webview state 长期保存 base64 正文。

#### 3.3 模型选择

- 选择器按 Provider 分组，显示模型名和能力。
- 提供刷新、不可用和未认证状态，不用空列表静默失败。
- 当前会话保存模型选择，新建会话继承用户最后一次选择。

#### 3.4 Skill 选择

- 从 OpenCode `/skill` 能力读取实际已加载 Skill，而不是仅扫描“已复制目录”。
- Composer 默认项为 `Auto`；用户可显式选择一个 Skill。
- 推荐首版语义：选择 Skill 后，在 Prompt 中明确要求 OpenCode 通过原生 skill tool 加载该 Skill，不手工复制 `SKILL.md` 全文。
- 该行为先用真实 Server 做合同测试；如果当前版本提供专用 Skill Prompt 字段，则改用原生字段。
- 设置页负责安装/管理 Skill，Composer 只负责本轮选择。

#### Stage 3 验收

- 输入 `@` 能在 300ms 内显示过滤结果并附加文件。
- 文件/图片附件在发送前可见、可移除，发送后不会残留到下一轮。
- 选择明确 Skill 后，可从工具事件确认该 Skill 被加载；`Auto` 不强制加载。
- 模型不支持图片时不能带图发送，也不会静默丢图。

### Stage 4：设置与 MCP 管理

#### 4.1 设置页结构

建议使用全宽覆盖页或侧边栏内部路由，不使用固定 `w-80` 的二级抽屉：

- `Connection`：连接状态、Server URL、CLI 路径、端口、版本和重新连接。
- `Models`：Provider 认证入口、模型刷新和默认模型。
- `Skills`：已加载列表、添加、打开目录、移除和刷新。
- `MCP`：配置和运行状态。

#### 4.2 MCP 功能

- 分开表示 `transport` 和 `status`，修复当前把 connected/failed 当 transport 的问题。
- 支持 local stdio 与 remote HTTP；表单按 SDK schema 校验 command、environment、URL、headers、timeout 和 enabled。
- 支持新增、编辑、启用/禁用、连接/断开、删除和失败原因展示。
- OAuth MCP 显示授权状态和授权动作，不在 Webview 暴露 client secret。
- 配置写入以 OpenCode Config/API 为唯一事实源，不在插件内维护第二份 MCP 配置。

#### Stage 4 验收

- 新增一个 stdio MCP 后能看到真实 transport、连接状态和工具列表变化。
- 配置错误显示 Server 返回的失败原因。
- 编辑、禁用和删除在 Reload Window 后仍与 OpenCode 状态一致。
- 所有凭据只在 Extension Host/OpenCode 侧处理。

### Stage 5：结构化消息与质量保障

- 消息 Store 按 `sessionId/messageId/partId` 更新，不再拼接到“最后一条 assistant 消息”。
- 渲染 text、reasoning、tool、step、file、question、permission、error 和 diff summary。
- Tool Card 显示工具名、运行状态、耗时、截断后的输入/输出和错误。
- Markdown 使用成熟解析器并进行 HTML sanitize；代码块和长命令局部滚动。
- Plan 完成动作挂到同一条 Assistant 消息，不再额外生成重复的“Plan completed”消息。
- 增加自动滚动、用户上滚后暂停、回到底部按钮、Error Boundary 和重试入口。

测试层级：

- 单元测试：事件适配、去重、请求状态机、附件预算、MCP schema。
- 合同测试：用脱敏 fixture 覆盖 1.18.25 真实事件。
- 集成测试：本机 OpenCode + Hy3 Free，验证 text/tool/permission/cancel/reconnect。
- Webview 测试：Session Store、历史切换、Composer resize、附件和错误终态。
- VS Code E2E：安装 VSIX 后执行新建对话、发送、工具审批、历史恢复和 MCP 配置。
- 视觉检查：260/350/480px 宽度以及深色/浅色/高对比度主题截图。

## 5. 文件级改动预估

新增：

- `src/opencode/eventAdapter.ts`
- `src/opencode/eventStreamManager.ts`
- `src/opencode/sessionController.ts`
- `webview/src/state/sessionStore.ts`
- `webview/src/components/HeaderBar.tsx`
- `webview/src/components/HistoryPanel.tsx`
- `webview/src/components/Composer.tsx`
- `webview/src/components/AttachmentShelf.tsx`
- `webview/src/components/FileMentionMenu.tsx`
- `webview/src/components/SettingsView.tsx`
- 对应测试和脱敏 fixtures

重点修改：

- `src/opencode/sdkClient.ts`
- `src/opencode/sdkTypes.ts`
- `src/webview/provider.ts`
- `src/shared/messages.ts`
- `webview/src/App.tsx`
- `webview/src/components/MessageList.tsx`
- `webview/src/components/MessageCard.tsx`
- `webview/src/index.css`
- `scripts/sdk-smoke-test.mjs`

在 Stage 0 稳定前不急于拆分所有文件；先用测试锁定事件契约，再按职责迁移，避免一次重写导致无法判断回归来源。

## 6. 需要审批的方案

### D1：SDK 接入策略

推荐：保留当前稳定的 Session API 调用，同时在边界层采用 `@opencode-ai/sdk/v2` 的事件类型和运行时 schema；完成合同测试后再决定是否整体迁移 v2 client。

理由：当前故障来自事件契约，不应在没有测试的情况下同时替换所有 API 调用。

### D2：Skill 选择语义

推荐：`Auto + 单个显式 Skill`。显式选择时要求 OpenCode 使用原生 skill tool 加载，不直接拼接 Skill 文件全文。

理由：避免重复上下文、Token 浪费和插件侧 Skill 解析漂移。

### D3：设置页形态

推荐：侧边栏内部全宽设置页，顶部返回按钮；不用右侧固定宽度抽屉。

理由：VS Code 侧边栏通常只有 260px 到 400px，二级抽屉容易再次产生裁切。

### D4：界面模仿范围

推荐：复用 CodeBuddy 的信息架构和交互密度，但使用 RainEye/OpenCode 自己的名称、颜色和组件细节，不做逐像素品牌复制。

## 7. 建议执行顺序

1. 先只实施 Stage 0，并生成一个可安装 VSIX 供真实 Hy3 Free 验收。
2. Stage 0 通过后实施 Stage 1 和 Stage 2，交付完整会话外壳。
3. 再实施 Stage 3 和 Stage 4，补齐附件、Skill 和 MCP。
4. 最后完成结构化渲染、E2E、视觉回归和发布检查。

第一批代码改动应严格限制在事件流、请求状态机、诊断和测试，不和界面重构混在同一批提交中。
