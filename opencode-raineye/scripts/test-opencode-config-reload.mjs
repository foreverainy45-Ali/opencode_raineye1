import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryDirectory = path.dirname(extensionDirectory);
const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "raineye-opencode-reload-"));
const projectDirectory = path.join(runtimeDirectory, "project");
await fs.mkdir(projectDirectory, { recursive: true });
const port = await freePort();
const executable = process.platform === "win32"
  ? path.join(process.env.APPDATA ?? "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe")
  : "opencode";
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(runtimeDirectory, "config"),
  XDG_DATA_HOME: path.join(runtimeDirectory, "data"),
  XDG_CACHE_HOME: path.join(runtimeDirectory, "cache"),
  XDG_STATE_HOME: path.join(runtimeDirectory, "state"),
};
const child = spawn(executable, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
  cwd: projectDirectory,
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  await waitFor(async () => (await getJson("/global/health")).healthy === true, 15_000, "OpenCode health");
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "raineye-reload-test": {
        name: "RainEye Reload Test",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://example.test/v1", apiKey: "test-key" },
        models: { "test-model": { name: "Test Model" } },
      },
    },
    mcp: {
      "raineye-python-test": {
        type: "local",
        command: ["python", path.join(repositoryDirectory, "examples", "python-mcp", "server.py")],
        cwd: repositoryDirectory,
        enabled: true,
        timeout: 10_000,
      },
    },
    skills: { paths: [path.join(repositoryDirectory, ".opencode", "skills", "raineye-python-test")] },
  };
  await fs.writeFile(path.join(projectDirectory, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await request("/instance/dispose", { method: "POST" });

  const providers = await waitFor(async () => {
    const value = await getJson("/config/providers");
    return value.providers?.some((provider) => provider.id === "raineye-reload-test") ? value : undefined;
  }, 15_000, "custom provider reload");
  const skills = await waitFor(async () => {
    const value = await getJson("/skill");
    return value.some((skill) => skill.name === "raineye-python-test") ? value : undefined;
  }, 10_000, "Skill reload");
  const mcps = await waitFor(async () => {
    const value = await getJson("/mcp");
    return value["raineye-python-test"]?.status === "connected" ? value : undefined;
  }, 15_000, "MCP reload");

  const provider = providers.providers.find((item) => item.id === "raineye-reload-test");
  if (!provider.models?.["test-model"]) throw new Error("Custom model missing after provider reload");
  if (!skills.some((skill) => skill.name === "raineye-python-test")) throw new Error("Skill missing after reload");
  if (mcps["raineye-python-test"].status !== "connected") throw new Error("MCP did not connect after reload");
  process.stdout.write("OpenCode official config reload: provider/model, Skill and MCP passed\n");
} finally {
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  await fs.rm(runtimeDirectory, { recursive: true, force: true });
}

async function getJson(route) {
  const response = await request(route);
  return await response.json();
}

async function request(route, init) {
  const separator = route.includes("?") ? "&" : "?";
  const response = await fetch(`http://127.0.0.1:${port}${route}${separator}directory=${encodeURIComponent(projectDirectory)}`, init);
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${await response.text()}`);
  return response;
}

async function waitFor(probe, timeout, label) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError}` : ""}\n${stderr}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const value = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
