# OpenCode RainEye

CodeBuddy 风格的 VS Code 侧边栏客户端，运行时完全复用官方 OpenCode Server 1.18.25。

## 主要能力

- 自动发现（包括外部 PowerShell 的未知监听端口）、托管启动或手动连接 OpenCode Server。
- 通过 OpenCode health/path API 鉴别进程、匹配工作区，并单独处理需要密码的实例。
- 新对话、历史会话、SSE 消息、Reasoning/Tool/附件/Diff 展示。
- Craft 执行前权限审批与执行后 Diff；只读 Plan 工作流。
- 输入 `@` 后按工作区路径自动补全文件，也可使用文件选择器；支持图片附件和可拖动 Composer。
- 官方 MCP `local`/`remote` 配置、连接状态和 OAuth 入口；保存时同时持久化配置并动态接入当前进程。
- 在设置中选择根目录含 `SKILL.md` 的文件夹，校验后注册到官方 `skills.paths`。
- 在设置中用 Base URL、API Key、Provider ID 和 Model ID 创建 OpenCode 原生自定义 Provider/Model。

## 开发

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run package-vsix
npm.cmd run verify-vsix
```

MCP、Skill 和自定义模型会写入 OpenCode 官方 `opencode.json/opencode.jsonc`；若检测到旧版 RainEye 生成的 `config.json`，设置页会提示迁移。

VSIX 输出到 `../out/opencode-raineye-0.3.2.vsix`，扩展 ID 为 `foreverainy45-ali.opencode-raineye`。

仓库根目录的 `examples/python-mcp/` 是零依赖 Python MCP 测试服务；`.opencode/skills/raineye-python-test/` 是会执行 Python 脚本并输出“测试成功”的 Skill 示例。

如果 VS Code 报 `Could not register service worker`，这是 VS Code Webview 宿主在加载扩展页面之前的错误。关闭所有 VS Code 窗口重启；若所有 Webview 都失败，再备份并清理 `%APPDATA%\Code\Service Worker`。

完整架构、协议边界与验收标准见仓库根目录的 `OPENCODE_PLUGIN_DEVELOPMENT_PLAN.md`。
