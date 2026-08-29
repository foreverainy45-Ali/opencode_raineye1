# RainEye Python MCP 测试服务

这是一个不依赖第三方 Python 包的 MCP stdio 服务，提供工具 `raineye_test`。调用成功后固定返回“测试成功”。

在 RainEye 的“设置 → MCP → 添加 MCP Server”中填写：

- 名称：`raineye-python-test`
- 作用域：`当前项目`
- 类型：`本机 stdio`
- 命令（JSON 数组）：`["python", "./examples/python-mcp/server.py"]`
- 环境变量：`{}`
- 超时：`10000`
- 启用：勾选

等价的 OpenCode 原生配置见 [opencode.snippet.json](./opencode.snippet.json)。配置后点击该 MCP 的“连接”，再让模型调用 `raineye_test` 即可。

要求从仓库根目录 `E:\opencode_raineye1` 启动或连接 OpenCode；如果 OpenCode 的工作目录不同，请把脚本路径改为绝对路径。

也可以在 `opencode-raineye/` 下运行 `npm.cmd run test:examples`，一次验证 MCP JSON-RPC 和 Skill Python 脚本。
