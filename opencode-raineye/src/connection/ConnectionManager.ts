import * as vscode from "vscode";
import { ConnectionState } from "../shared/protocol";
import { Logger } from "../services/Logger";
import { ManagedServer } from "./ManagedServer";
import { basicAuthorization, normalizeEndpoint } from "../shared/endpoint";

export interface ActiveConnection {
  endpoint: string;
  password?: string;
  version: string;
}

interface StoredEndpoint {
  endpoint: string;
}

interface Candidate {
  endpoint: string;
  source: NonNullable<ConnectionState["source"]>;
}

const LAST_ENDPOINT_KEY = "opencodeRaineye.lastEndpoint";

export class ConnectionManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ConnectionState>();
  private readonly connectedEmitter = new vscode.EventEmitter<ActiveConnection>();
  private readonly managed: ManagedServer;
  private currentState: ConnectionState = { phase: "disconnected" };
  private password?: string;

  readonly onDidChangeState = this.emitter.event;
  readonly onDidConnect = this.connectedEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    private readonly workspacePath: string,
  ) {
    this.managed = new ManagedServer(logger);
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  get active(): ActiveConnection | undefined {
    if (this.currentState.phase !== "connected" || !this.currentState.endpoint || !this.currentState.version) return undefined;
    return { endpoint: this.currentState.endpoint, password: this.password, version: this.currentState.version };
  }

  async discover(): Promise<ActiveConnection | undefined> {
    this.setState({ phase: "discovering", message: "正在查找 OpenCode 进程…" });
    const candidates = this.discoveryCandidates();
    this.logger.info("Discovering OpenCode servers", candidates.map((item) => item.endpoint));

    for (const candidate of candidates) {
      try {
        return await this.connect(candidate.endpoint, candidate.source, undefined, false);
      } catch (error) {
        this.logger.debug(`OpenCode endpoint unavailable: ${candidate.endpoint}`, error);
      }
    }

    const autoStart = vscode.workspace.getConfiguration("opencodeRaineye").get<boolean>("autoStart", false);
    if (autoStart) {
      try {
        return await this.startManaged();
      } catch (error) {
        this.logger.warn("Automatic OpenCode start failed", error);
        this.setState({ phase: "error", message: readableError(error) });
        return undefined;
      }
    }

    this.setState({ phase: "disconnected", message: "未发现 OpenCode，可新建进程或手动连接。" });
    return undefined;
  }

  async reconnect(): Promise<ActiveConnection | undefined> {
    const endpoint = this.currentState.endpoint;
    if (!endpoint) return await this.discover();
    try {
      return await this.connect(endpoint, this.currentState.source ?? "manual", this.password);
    } catch (error) {
      this.setState({ phase: "error", endpoint, message: readableError(error) });
      return undefined;
    }
  }

  async connectManual(host: string, port: number, password?: string): Promise<ActiveConnection> {
    const endpoint = normalizeEndpoint(host, port);
    return await this.connect(endpoint, "manual", password?.trim() || undefined);
  }

  async startManaged(): Promise<ActiveConnection> {
    this.setState({ phase: "starting", message: "正在启动 OpenCode…" });
    const configured = vscode.workspace.getConfiguration("opencodeRaineye").get<string>("command", "opencode");
    const server = await this.managed.start(configured, this.workspacePath);
    const deadline = Date.now() + 20_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        return await this.connect(server.endpoint, "managed", undefined, false);
      } catch (error) {
        lastError = error;
        await delay(350);
      }
    }
    this.managed.stop();
    const suffix = lastError ? `：${readableError(lastError)}` : "";
    throw new Error(`OpenCode 启动超时${suffix}`);
  }

  async connect(
    endpoint: string,
    source: NonNullable<ConnectionState["source"]>,
    password?: string,
    reportError = true,
  ): Promise<ActiveConnection> {
    const normalized = endpoint.replace(/\/$/, "");
    this.setState({ phase: "connecting", endpoint: normalized, source, message: "正在连接 OpenCode…" });
    try {
      const health = await healthCheck(normalized, password);
      this.password = password;
      const state: ConnectionState = {
        phase: "connected",
        endpoint: normalized,
        source,
        version: health.version,
        message: `OpenCode ${health.version}`,
      };
      this.setState(state);
      await this.context.workspaceState.update(LAST_ENDPOINT_KEY, { endpoint: normalized } satisfies StoredEndpoint);
      const active = { endpoint: normalized, password, version: health.version };
      this.connectedEmitter.fire(active);
      return active;
    } catch (error) {
      if (reportError) this.setState({ phase: "error", endpoint: normalized, source, message: readableError(error) });
      throw error;
    }
  }

  dispose(): void {
    this.managed.dispose();
    this.emitter.dispose();
    this.connectedEmitter.dispose();
  }

  private discoveryCandidates(): Candidate[] {
    const config = vscode.workspace.getConfiguration("opencodeRaineye");
    const configuredUrl = config.get<string>("serverUrl", "").trim();
    const configuredPort = config.get<number>("serverPort", 4096);
    const remembered = this.context.workspaceState.get<StoredEndpoint>(LAST_ENDPOINT_KEY);
    const items: Candidate[] = [];

    if (configuredUrl) items.push({ endpoint: normalizeEndpoint(configuredUrl, configuredPort), source: "configured" });
    if (remembered?.endpoint) items.push({ endpoint: remembered.endpoint, source: "remembered" });

    for (const terminal of vscode.window.terminals) {
      const options = terminal.creationOptions;
      const env = "env" in options ? options.env : undefined;
      const value = env?._EXTENSION_OPENCODE_PORT;
      if (typeof value === "string" && /^\d+$/.test(value)) {
        items.push({ endpoint: `http://127.0.0.1:${value}`, source: "terminal" });
      }
    }

    items.push({ endpoint: `http://127.0.0.1:${configuredPort}`, source: "local" });
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.endpoint)) return false;
      seen.add(item.endpoint);
      return true;
    });
  }

  private setState(state: ConnectionState): void {
    this.currentState = state;
    this.emitter.fire(state);
  }
}

export function createAuthenticatedFetch(password?: string): typeof fetch {
  if (!password) return fetch;
  const authorization = basicAuthorization(password);
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization")) headers.set("authorization", authorization);
    return await fetch(input, { ...init, headers });
  };
}

async function healthCheck(endpoint: string, password?: string): Promise<{ healthy: true; version: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await createAuthenticatedFetch(password)(`${endpoint}/global/health`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`OpenCode 健康检查失败（HTTP ${response.status}）`);
    const value = await response.json() as { healthy?: unknown; version?: unknown };
    if (value.healthy !== true || typeof value.version !== "string") throw new Error("OpenCode 返回了无效的健康检查数据");
    return { healthy: true, version: value.version };
  } finally {
    clearTimeout(timer);
  }
}

function readableError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "连接 OpenCode 超时";
  if (error instanceof Error) return error.message;
  return String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
