# Changelog

## 0.1.1 - 2026-08-29

- 修复 `package.json` 将 CommonJS 扩展入口错误声明为 ESM，导致扩展激活失败、命令未注册和侧栏不显示的问题。
- VSIX 验证新增 Extension Host 模块格式冲突检查。

## 0.1.0 - 2026-08-29

- 首个可安装 MVP。
- 接入 OpenCode 1.18.25 Server/SDK、全局事件、Session、Model、Agent、Skill、MCP、Permission、Question 与 Diff。
- 实现 CodeBuddy 风格侧边栏、历史、设置、附件和 Craft/Plan 工作流。
- 增加 Windows CLI 自动定位、外部/托管进程边界、VSIX 身份校验与基础测试。
