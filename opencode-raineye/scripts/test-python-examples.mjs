import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extensionDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryDirectory = path.dirname(extensionDirectory);
const mcpServer = path.join(repositoryDirectory, "examples", "python-mcp", "server.py");
const skillScript = path.join(repositoryDirectory, ".opencode", "skills", "raineye-python-test", "scripts", "test_success.py");
const messages = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raineye-test", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "raineye_test", arguments: {} } },
];

const mcp = spawnSync("python", [mcpServer], {
  cwd: repositoryDirectory,
  input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
  encoding: "utf8",
});
if (mcp.error) throw mcp.error;
if (mcp.status !== 0) throw new Error(`Python MCP exited with ${mcp.status}: ${mcp.stderr}`);
const responses = mcp.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
const tools = responses.find((message) => message.id === 2)?.result?.tools;
const text = responses.find((message) => message.id === 3)?.result?.content?.[0]?.text;
if (!Array.isArray(tools) || tools[0]?.name !== "raineye_test" || text !== "测试成功") {
  throw new Error(`Unexpected MCP response: ${mcp.stdout}`);
}

const skill = spawnSync("python", [skillScript], { cwd: repositoryDirectory, encoding: "utf8" });
if (skill.error) throw skill.error;
if (skill.status !== 0) throw new Error(`Skill script exited with ${skill.status}: ${skill.stderr}`);
if (skill.stdout.trim() !== "测试成功") throw new Error(`Unexpected Skill output: ${skill.stdout}`);

process.stdout.write("Python MCP and Skill examples: 测试成功\n");
