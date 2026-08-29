# Changelog

## 0.3.0 - 2026-08-29

- 设置页支持创建项目/全局 OpenCode Skill，以及注册 `skills.paths` 和 `skills.urls`。
- 设置页支持以 Base URL、API Key、Provider/Model ID 配置 OpenCode 原生 OpenAI-compatible 自定义模型。
- Composer 支持输入 `@` 自动检索并补全工作区路径。
- MCP 保存后调用 OpenCode 原生动态添加接口，当前进程立即连接，同时保留持久化配置。
- 附带可返回“测试成功”的零依赖 Python MCP 和 Python Skill 示例。
- 多实例选择框保持显示，输出日志记录候选与选择结果。

## 0.2.1 - 2026-08-29

- “自动发现”始终重新枚举全部候选，可发现插件激活后才启动的 Server。
- 检测到普通 OpenCode TUI 但没有 HTTP 监听端口时，明确提示使用 `opencode --port 0`；普通 `opencode` 进程本身无法供插件连接。

## 0.2.0 - 2026-08-29

- 按配置、托管元数据、最近连接、Terminal 环境变量、可选 mDNS、本机监听端口和默认端口的顺序发现 OpenCode。
- Windows 使用 `netstat -ano -p tcp` 枚举 LISTENING 端口，以 24 路有限并发调用 `/global/health` 鉴别，不扫描全部端口。
- 使用 `/path` 优先匹配当前工作区；存在多个匹配实例时由用户选择。
- 单独呈现 HTTP 401 密码状态，并持久化 endpoint、PID、工作区路径和版本。
- 托管进程发生端口抢占时自动重新选择空闲端口。

## 0.1.1 - 2026-08-29

- 修复 `package.json` 将 CommonJS 扩展入口错误声明为 ESM，导致扩展激活失败、命令未注册和侧栏不显示的问题。
- VSIX 验证新增 Extension Host 模块格式冲突检查。

## 0.1.0 - 2026-08-29

- 首个可安装 MVP。
- 接入 OpenCode 1.18.25 Server/SDK、全局事件、Session、Model、Agent、Skill、MCP、Permission、Question 与 Diff。
- 实现 CodeBuddy 风格侧边栏、历史、设置、附件和 Craft/Plan 工作流。
- 增加 Windows CLI 自动定位、外部/托管进程边界、VSIX 身份校验与基础测试。
