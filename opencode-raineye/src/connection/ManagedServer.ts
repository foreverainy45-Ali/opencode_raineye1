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
  pid?: number;
}

export class ManagedServer implements vscode.Disposable {
  private child?: ChildProcessWithoutNullStreams;
  private lastExitText = "";

  constructor(private readonly logger: Logger) {}

  get isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  get lastExitWasAddressInUse(): boolean {
    return isAddressInUse(new Error(this.lastExitText));
  }

  async start(configuredCommand: string, workspacePath: string): Promise<ManagedServerInfo> {
    this.stop();
    const command = await resolveOpenCodeCommand(configuredCommand);
    let lastError: unknown;

    // Releasing the temporary socket before OpenCode binds creates a tiny
    // unavoidable race. Detect an immediate EADDRINUSE exit and allocate a new
    // port instead of making the user retry manually.
    for (let attempt = 1; attempt <= 4; attempt++) {
      const port = await findFreePort();
      try {
        const child = await this.spawnAttempt(command, workspacePath, port);
        return {
          endpoint: `http://127.0.0.1:${port}`,
          port,
          command,
          pid: child.pid,
        };
      } catch (error) {
        lastError = error;
        if (!isAddressInUse(error) || attempt === 4) throw error;
        this.logger.warn("Managed OpenCode port was taken; retrying with another port", { port, attempt });
      }
    }

    throw lastError ?? new Error("Could not start OpenCode");
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

  private async spawnAttempt(command: string, workspacePath: string, port: number): Promise<ChildProcessWithoutNullStreams> {
    const args = ["serve", "--hostname", "127.0.0.1", "--port", String(port)];
    this.logger.info("Starting managed OpenCode server", { command, args, workspacePath });
    const child = spawn(command, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        OPENCODE_CALLER: "vscode",
      },
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      stdio: "pipe",
    });
    this.child = child;
    this.lastExitText = "";

    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => this.logger.debug("OpenCode stdout", chunk.toString().trim()));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-8_192);
      this.lastExitText = stderr;
      this.logger.warn("OpenCode stderr", text.trim());
    });
    child.on("exit", (code, signal) => {
      this.logger.info("Managed OpenCode server exited", { code, signal });
      if (this.child === child) this.child = undefined;
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        child.off("spawn", onSpawn);
        this.lastExitText = error.message;
        if (this.child === child) this.child = undefined;
        reject(error);
      };
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });

    if (child.exitCode !== null) {
      throw new Error(`OpenCode exited during startup (${child.exitCode}): ${stderr.trim()}`);
    }

    const earlyExit = await Promise.race([
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }),
      delay(500).then(() => undefined),
    ]);
    if (earlyExit) {
      throw new Error(`OpenCode exited during startup (${earlyExit.code ?? earlyExit.signal ?? "unknown"}): ${stderr.trim()}`);
    }
    return child;
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

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && /EADDRINUSE|address.+already.+in use|鍦板潃.+浣跨敤/i.test(error.message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
