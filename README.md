# OpenCode RainEye

OpenCode RainEye 是一个面向 VS Code 的 OpenCode 侧边栏客户端。界面参考 CodeBuddy，但会话、模型、Agent、Skill、MCP、权限请求与 Diff 都直接来自官方 OpenCode Server；扩展不实现第二套 Agent Runtime、Skill Loader 或 MCP Client。

当前版本：`0.3.1`，首个验证目标为 VS Code 1.94+、Windows 11 与 OpenCode 1.18.25。

## 已实现

- Activity Bar 原生 View Container 与轻量 WebviewView 聊天界面。
- 新增对话、历史对话、设置页和官方 TUI 入口。
- 自动发现已配置地址、托管实例元数据、上次连接、Terminal 环境变量、可选 mDNS、本机 LISTENING 端口与默认端口；多个实例时明确选择。
- 未发现进程时，可启动扩展托管的 `opencode serve`，或手动填写本机/远程 URL、端口和密码。
- OpenCode 全局 SSE 事件、消息、Tool/Reasoning/File/Patch 渲染、停止生成与恢复会话。
- 可上下拖动的 Composer；输入 `@` 自动补全工作区路径，上方悬挂文件与图片附件；底部选择 Craft/Plan、模型与 Skill。
- Craft 使用 OpenCode 原生 Permission，在 `edit`/`bash` 执行前审批；结束后显示官方 Session Diff。
- Plan 映射官方 `plan` Agent，并关闭修改/命令类工具。
- MCP 设置严格使用官方 `local`/`remote` schema；保存时持久化配置并通过官方动态 API 接入当前进程。
- Skill 列表来自官方 `/skill`；设置页选择根目录含 `SKILL.md` 的文件夹并注册到 `skills.paths`。
- 自定义模型表单写入 OpenCode 原生 Provider 配置，支持 Base URL、API Key、OpenAI-compatible/Responses 和模型能力参数。

详细设计与已确认边界见 [OPENCODE_PLUGIN_DEVELOPMENT_PLAN.md](./OPENCODE_PLUGIN_DEVELOPMENT_PLAN.md)。

## 目录

- `opencode-raineye/`：扩展源码、测试与构建脚本。
- `.vscode/`：从仓库根目录启动 Extension Development Host 的配置。
- `examples/python-mcp/`：返回“测试成功”的零依赖 Python MCP 与可粘贴配置。
- `.opencode/skills/raineye-python-test/`：调用 Python 脚本的 OpenCode Skill 示例。
- `out/opencode-raineye-0.3.1.vsix`：本地构建产物，默认不提交 Git。
- `sst-dev.opencode-0.0.13.vsix`、`vsix_extracted/`：官方插件参考基线。
- `界面页.png`：界面参考图。

## 开发与打包

```powershell
cd opencode-raineye
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run package-vsix
npm.cmd run verify-vsix
```

也可以从仓库根目录在 VS Code 中按 `F5`，选择 `Run RainEye Extension`。该配置会先构建，并明确以 `opencode-raineye/` 作为扩展目录；不要把仓库根目录误当成扩展目录。

安装本地包：

```powershell
code.cmd --install-extension out\opencode-raineye-0.3.1.vsix --force
```

打包后的扩展 ID 为 `foreverainy45-ali.opencode-raineye`。

## Webview Service Worker 报错

若出现 `Could not register service worker ... document is in an invalid state`，错误发生在 VS Code 创建 Webview 文档之前，并非 RainEye HTML 主动注册 Service Worker。它通常会同时影响 Markdown 预览、Git Graph 等其他 Webview。

建议按顺序处理：

1. 关闭所有 VS Code 窗口后重新打开。
2. 确认使用仓库内的 `Run RainEye Extension` 启动配置，不要同时保留错误的开发宿主实例。
3. 若所有 Webview 都失败，备份后清理 VS Code 的 `%APPDATA%\Code\Service Worker` 缓存，再重新启动 VS Code。

仓库的 `.vscode/extensions.json` 不包含任何工作区推荐，因此不会生成 `undefined_publisher.opencode-raineye`；当前 VSIX 验证脚本也会拒绝缺失或非法 publisher/name 的 manifest。

相关 VS Code 上游问题：[microsoft/vscode#125993](https://github.com/microsoft/vscode/issues/125993)、[microsoft/vscode#330595](https://github.com/microsoft/vscode/issues/330595)。

## 安全边界

- Webview 不能直接访问文件系统、Shell 或 OpenCode Server；所有操作经 Extension Host 校验。
- Server Password 仅保存在当前扩展运行内存，不写入 Webview 状态。
- Webview 发来的路径只能在当前工作区内打开。
- 权限审批不是操作系统沙箱；批准命令后，OpenCode 仍以当前本机用户权限运行。
