import * as vscode from "vscode";
import type { ConnectionState } from "../shared/protocol";
import { normalizeEndpoint } from "../shared/endpoint";
import { Logger } from "../services/Logger";
import { enumerateLocalListeningEndpoints } from "./LocalEndpointDiscovery";
import { discoverMdnsEndpoints } from "./MdnsDiscovery";
import { ManagedServer } from "./ManagedServer";
import { findOpenCodeProcessIds } from "./OpenCodeProcessDiscovery";
import {
  mapWithConcurrency,
  pathMatchesWorkspace,
  preferredWorkspacePath,
  probeOpenCode,
  type ProbeResult,
} from "./ServerProbe";

export { createAuthenticatedFetch } from "./authenticatedFetch";

type ConnectionSource = NonNullable<ConnectionState["source"]>;

export interface ActiveConnection {
  endpoint: string;
  password?: string;
  version: string;
  pid?: number;
  workspacePath?: string;
}

interface StoredConnectionMetadata {
  endpoint: string;
  pid?: number;
  workspacePath?: string;
  version?: string;
  source?: ConnectionSource;
  updatedAt?: number;
}

interface Candidate extends StoredConnectionMetadata {
  source: ConnectionSource;
  priority: number;
}

interface CandidateResult {
  candidate: Candidate;
  probe: ProbeResult;
  order: number;
}

const LAST_ENDPOINT_KEY = "opencodeRaineye.lastEndpoint";
const MANAGED_ENDPOINT_KEY = "opencodeRaineye.managedEndpoint";
const DISCOVERY_TIMEOUT_MS = 450;
const DISCOVERY_CONCURRENCY = 24;

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
    return {
      endpoint: this.currentState.endpoint,
      password: this.password,
      version: this.currentState.version,
      pid: this.currentState.pid,
      workspacePath: this.currentState.workspacePath,
    };
  }

  async discover(): Promise<ActiveConnection | undefined> {
    this.setState({ phase: "discovering", message: "正在查找 OpenCode 进程…" });
    const candidates = await this.discoveryCandidates();
    this.logger.info("Discovering OpenCode servers", candidates.map(({ endpoint, source, pid }) => ({ endpoint, source, pid })));

    const results = await mapWithConcurrency(candidates, DISCOVERY_CONCURRENCY, async (candidate, order) => {
      const probe = await probeOpenCode(candidate.endpoint, { timeoutMs: DISCOVERY_TIMEOUT_MS });
      if (probe.status === "unavailable") this.logger.debug(`OpenCode endpoint unavailable: ${candidate.endpoint}`, probe.error);
      return { candidate, probe, order } satisfies CandidateResult;
    });

    const healthy = results.filter((item): item is CandidateResult & { probe: Extract<ProbeResult, { status: "healthy" }> } => item.probe.status === "healthy");
    const selected = await this.selectHealthyCandidate(healthy);
    if (selected) return await this.acceptConnection(selected.candidate, selected.probe);
    if (healthy.length) {
      this.setState({ phase: "disconnected", message: "已取消选择 OpenCode 实例。" });
      return undefined;
    }

    const authRequired = results.filter((item) => item.probe.status === "auth-required");
    if (authRequired.length) {
      const selectedAuth = await this.selectCandidate(authRequired, "选择需要输入密码的 OpenCode 实例");
      if (selectedAuth) {
        const { candidate } = selectedAuth;
        this.setState({
          phase: "auth-required",
          endpoint: candidate.endpoint,
          source: candidate.source,
          pid: candidate.pid,
          workspacePath: candidate.workspacePath,
          message: "已发现 OpenCode，但该实例需要密码。",
        });
      } else {
        this.setState({ phase: "disconnected", message: "已取消选择 OpenCode 实例。" });
      }
      return undefined;
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

    const processIds = await findOpenCodeProcessIds().catch((error) => {
      this.logger.debug("OpenCode process diagnostic failed", error);
      return [];
    });
    if (processIds.length) {
      this.logger.info("Found OpenCode processes without a verified HTTP endpoint", { processIds });
      this.setState({
        phase: "disconnected",
        message: `检测到 ${processIds.length} 个 OpenCode 进程，但没有可连接的 Server 端口。请使用 opencode --port 0 启动 TUI，或点击“新建本机进程”。`,
      });
    } else {
      this.setState({ phase: "disconnected", message: "未发现 OpenCode Server，可新建进程或手动连接。" });
    }
    return undefined;
  }

  async reconnect(): Promise<ActiveConnection | undefined> {
    // This action is labelled “自动发现” in the UI. Always rebuild the complete
    // candidate set so a server started after activation can be found, even if
    // the previous state still contains a stale/manual endpoint.
    return await this.discover();
  }

  async connectManual(host: string, port: number, password?: string): Promise<ActiveConnection> {
    const endpoint = normalizeEndpoint(host, port);
    return await this.connect(endpoint, "manual", password?.trim() || undefined);
  }

  async startManaged(): Promise<ActiveConnection> {
    this.setState({ phase: "starting", message: "正在启动 OpenCode…" });
    const configured = vscode.workspace.getConfiguration("opencodeRaineye").get<string>("command", "opencode");
    const deadline = Date.now() + 20_000;
    let lastError: unknown;

    for (let launchAttempt = 1; launchAttempt <= 4 && Date.now() < deadline; launchAttempt++) {
      const server = await this.managed.start(configured, this.workspacePath);
      while (Date.now() < deadline) {
        try {
          return await this.connect(server.endpoint, "managed", undefined, false, { pid: server.pid });
        } catch (error) {
          lastError = error;
          if (!this.managed.isRunning) break;
          await delay(350);
        }
      }
      if (!this.managed.lastExitWasAddressInUse) break;
      this.logger.warn("Managed OpenCode lost the port before it became healthy; selecting another port", { launchAttempt });
    }
    this.managed.stop();
    const suffix = lastError ? `：${readableError(lastError)}` : "";
    throw new Error(`OpenCode 启动超时${suffix}`);
  }

  async connect(
    endpoint: string,
    source: ConnectionSource,
    password?: string,
    reportError = true,
    metadata: Pick<StoredConnectionMetadata, "pid" | "workspacePath"> = {},
  ): Promise<ActiveConnection> {
    const normalized = endpoint.replace(/\/$/, "");
    this.setState({ phase: "connecting", endpoint: normalized, source, pid: metadata.pid, message: "正在连接 OpenCode…" });
    const probe = await probeOpenCode(normalized, { password, timeoutMs: 1_500 });

    if (probe.status === "healthy") {
      return await this.acceptConnection({ endpoint: normalized, source, priority: 0, ...metadata }, probe, password);
    }

    const error = probe.status === "auth-required"
      ? new AuthenticationRequiredError()
      : probe.error instanceof Error
        ? probe.error
        : new Error("OpenCode 健康检查失败");
    if (probe.status === "auth-required") {
      this.setState({
        phase: "auth-required",
        endpoint: normalized,
        source,
        pid: metadata.pid,
        workspacePath: metadata.workspacePath,
        message: "已发现 OpenCode，但该实例需要密码。",
      });
    } else if (reportError) {
      this.setState({ phase: "error", endpoint: normalized, source, pid: metadata.pid, message: readableError(error) });
    }
    throw error;
  }

  dispose(): void {
    this.managed.dispose();
    this.emitter.dispose();
    this.connectedEmitter.dispose();
  }

  private async discoveryCandidates(): Promise<Candidate[]> {
    const config = vscode.workspace.getConfiguration("opencodeRaineye");
    const configuredUrl = config.get<string>("serverUrl", "").trim();
    const configuredPort = config.get<number>("serverPort", 4096);
    const managed = this.context.workspaceState.get<StoredConnectionMetadata>(MANAGED_ENDPOINT_KEY);
    const remembered = this.context.workspaceState.get<StoredConnectionMetadata>(LAST_ENDPOINT_KEY);
    const mdnsEnabled = config.get<boolean>("mdnsDiscovery", false);
    const mdnsDomain = config.get<string>("mdnsDomain", "opencode.local").trim() || "opencode.local";

    const [mdnsEndpoints, localEndpoints] = await Promise.all([
      mdnsEnabled
        ? discoverMdnsEndpoints(mdnsDomain).catch((error) => {
          this.logger.debug("mDNS discovery failed", error);
          return [];
        })
        : Promise.resolve([]),
      enumerateLocalListeningEndpoints().catch((error) => {
        this.logger.debug("Local listening-port enumeration failed", error);
        return [];
      }),
    ]);

    const items: Candidate[] = [];
    if (configuredUrl) items.push({ endpoint: normalizeEndpoint(configuredUrl, configuredPort), source: "configured", priority: 0 });
    if (managed?.endpoint) items.push({ ...managed, source: "managed", priority: 1 });
    if (remembered?.endpoint) items.push({ ...remembered, source: "remembered", priority: 2 });

    for (const terminal of vscode.window.terminals) {
      const options = terminal.creationOptions;
      const env = "env" in options ? options.env : undefined;
      const value = env?._EXTENSION_OPENCODE_PORT;
      if (typeof value === "string" && /^\d+$/.test(value)) {
        items.push({ endpoint: `http://127.0.0.1:${value}`, source: "terminal", priority: 3 });
      }
    }

    items.push(...mdnsEndpoints.map(({ endpoint, pid }) => ({ endpoint, pid, source: "mdns" as const, priority: 4 })));
    items.push(...localEndpoints.map(({ endpoint, pid }) => ({ endpoint, pid, source: "listener" as const, priority: 5 })));
    items.push({ endpoint: `http://127.0.0.1:${configuredPort}`, source: "default", priority: 6 });

    const seen = new Set<string>();
    return items.filter((item) => {
      item.endpoint = item.endpoint.replace(/\/$/, "");
      if (seen.has(item.endpoint)) return false;
      seen.add(item.endpoint);
      return true;
    });
  }

  private async selectHealthyCandidate(
    candidates: Array<CandidateResult & { probe: Extract<ProbeResult, { status: "healthy" }> }>,
  ): Promise<(CandidateResult & { probe: Extract<ProbeResult, { status: "healthy" }> }) | undefined> {
    if (!candidates.length) return undefined;
    const ranked = [...candidates].sort((left, right) => {
      const leftMatches = pathMatchesWorkspace(left.probe.path, this.workspacePath);
      const rightMatches = pathMatchesWorkspace(right.probe.path, this.workspacePath);
      if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
      return left.candidate.priority - right.candidate.priority || left.order - right.order;
    });
    const matching = ranked.filter((item) => pathMatchesWorkspace(item.probe.path, this.workspacePath));
    if (matching.length === 1) return matching[0];
    if (ranked.length === 1) return ranked[0];
    return await this.selectCandidate(matching.length > 1 ? matching : ranked, "发现多个 OpenCode 实例，请选择要连接的实例");
  }

  private async selectCandidate<T extends CandidateResult>(candidates: T[], placeHolder: string): Promise<T | undefined> {
    if (candidates.length === 1) return candidates[0];
    const picked = await vscode.window.showQuickPick(
      candidates.map((item) => {
        const healthy = item.probe.status === "healthy" ? item.probe : undefined;
        const serverPath = healthy ? preferredWorkspacePath(healthy.path, this.workspacePath) : item.candidate.workspacePath;
        const version = healthy?.version ?? item.candidate.version;
        return {
          label: item.candidate.endpoint,
          description: [version ? `OpenCode ${version}` : undefined, sourceLabel(item.candidate.source), item.candidate.pid ? `PID ${item.candidate.pid}` : undefined]
            .filter(Boolean).join(" · "),
          detail: serverPath ? `目录：${serverPath}` : "未能读取实例目录",
          item,
        };
      }),
      { placeHolder, matchOnDescription: true, matchOnDetail: true },
    );
    return picked?.item;
  }

  private async acceptConnection(
    candidate: Candidate,
    probe: Extract<ProbeResult, { status: "healthy" }>,
    password?: string,
  ): Promise<ActiveConnection> {
    const workspacePath = preferredWorkspacePath(probe.path, this.workspacePath) ?? candidate.workspacePath;
    this.password = password;
    const state: ConnectionState = {
      phase: "connected",
      endpoint: candidate.endpoint,
      source: candidate.source,
      version: probe.version,
      pid: candidate.pid,
      workspacePath,
      message: `OpenCode ${probe.version}`,
    };
    this.setState(state);

    const stored: StoredConnectionMetadata = {
      endpoint: candidate.endpoint,
      pid: candidate.pid,
      workspacePath,
      version: probe.version,
      source: candidate.source,
      updatedAt: Date.now(),
    };
    await this.context.workspaceState.update(LAST_ENDPOINT_KEY, stored);
    if (candidate.source === "managed") await this.context.workspaceState.update(MANAGED_ENDPOINT_KEY, stored);

    const active: ActiveConnection = {
      endpoint: candidate.endpoint,
      password,
      version: probe.version,
      pid: candidate.pid,
      workspacePath,
    };
    this.connectedEmitter.fire(active);
    return active;
  }

  private setState(state: ConnectionState): void {
    this.currentState = state;
    this.emitter.fire(state);
  }
}

class AuthenticationRequiredError extends Error {
  constructor() {
    super("OpenCode 需要密码（HTTP 401）");
    this.name = "AuthenticationRequiredError";
  }
}

function sourceLabel(source: ConnectionSource): string {
  switch (source) {
    case "configured": return "用户配置";
    case "managed": return "RainEye 托管";
    case "remembered": return "上次连接";
    case "terminal": return "VS Code Terminal";
    case "mdns": return "mDNS";
    case "listener": return "本机监听端口";
    case "default": return "默认端口";
    case "manual": return "手动连接";
    default: return source;
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
