# OpenCode RainEye

CodeBuddy 风格的 VS Code 侧边栏客户端，运行时完全复用官方 OpenCode Server 1.18.25。

## 主要能力

- 自动发现（包括外部 PowerShell 的未知监听端口）、托管启动或手动连接 OpenCode Server。
- 通过 OpenCode health/path API 鉴别进程、匹配工作区，并单独处理需要密码的实例。
- 新对话、历史会话、SSE 消息、Reasoning/Tool/附件/Diff 展示。
- Craft 执行前权限审批与执行后 Diff；只读 Plan 工作流。
- `@` 文件引用、图片附件、可拖动 Composer、模型与 Skill 选择。
- 官方 MCP `local`/`remote` 配置、连接状态和 OAuth 入口。

## 开发

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run package-vsix
npm.cmd run verify-vsix
```

VSIX 输出到 `../out/opencode-raineye-0.2.0.vsix`，扩展 ID 为 `foreverainy45-ali.opencode-raineye`。

如果 VS Code 报 `Could not register service worker`，这是 VS Code Webview 宿主在加载扩展页面之前的错误。关闭所有 VS Code 窗口重启；若所有 Webview 都失败，再备份并清理 `%APPDATA%\Code\Service Worker`。

完整架构、协议边界与验收标准见仓库根目录的 `OPENCODE_PLUGIN_DEVELOPMENT_PLAN.md`。
