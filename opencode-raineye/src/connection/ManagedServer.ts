import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { Logger } from "../services/Logger";

export interface ManagedServerInfo {
  endpoint: string;
  port: number;
  command: string;
}

export class ManagedServer implements vscode.Disposable {
  private child?: ChildProcessWithoutNullStreams;

  constructor(private readonly logger: Logger) {}

  async start(configuredCommand: string, workspacePath: string): Promise<ManagedServerInfo> {
    this.stop();
    const port = await findFreePort();
    const command = await resolveOpenCodeCommand(configuredCommand);
    const args = ["serve", "--hostname", "127.0.0.1", "--port", String(port)];

    this.logger.info("Starting managed OpenCode server", { command, args, workspacePath });
    this.child = spawn(command, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        OPENCODE_CALLER: "vscode",
      },
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      stdio: "pipe",
    });

    this.child.stdout.on("data", (chunk: Buffer) => this.logger.debug("OpenCode stdout", chunk.toString().trim()));
    this.child.stderr.on("data", (chunk: Buffer) => this.logger.warn("OpenCode stderr", chunk.toString().trim()));
    this.child.on("exit", (code, signal) => {
      this.logger.info("Managed OpenCode server exited", { code, signal });
      this.child = undefined;
    });

    await new Promise<void>((resolve, reject) => {
      const child = this.child;
      if (!child) return reject(new Error("OpenCode process was not created"));
      const onError = (error: Error) => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });

    return {
      endpoint: `http://127.0.0.1:${port}`,
      port,
      command,
    };
  }

  stop(): void {
    if (!this.child) return;
    this.logger.info("Stopping managed OpenCode server");
    this.child.kill();
    this.child = undefined;
  }

  dispose(): void {
    this.stop();
  }
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an OpenCode server port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function resolveOpenCodeCommand(configured: string): Promise<string> {
  const input = configured.trim() || "opencode";
  if (path.isAbsolute(input) || input.includes(path.sep) || input.includes("/")) {
    if (!fs.existsSync(input)) throw new Error(`OpenCode command does not exist: ${input}`);
    return input;
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? [".exe", ".cmd", ".bat", ""]
    : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, input + extension);
      if (!fs.existsSync(candidate)) continue;
      if (process.platform === "win32" && /\.cmd$/i.test(candidate)) {
        const directExe = path.join(path.dirname(candidate), "node_modules", "opencode-ai", "bin", "opencode.exe");
        if (fs.existsSync(directExe)) return directExe;
      }
      return candidate;
    }
  }
  return input;
}
