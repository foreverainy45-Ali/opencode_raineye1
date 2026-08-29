import * as path from "node:path";
import * as vscode from "vscode";
import { ConnectionManager, type ActiveConnection } from "../connection/ConnectionManager";
import { OpenCodeAdapter } from "../opencode/OpenCodeAdapter";
import { Logger } from "../services/Logger";
import {
  AttachmentView,
  ChatMode,
  McpInput,
  PermissionReply,
  SettingsView,
  UiSnapshot,
  ViewSection,
  WebviewToHostMessage,
} from "../shared/protocol";

const MODEL_KEY = "opencodeRaineye.selectedModel";
const SKILL_KEY = "opencodeRaineye.selectedSkill";
const SECTION_KEY = "opencodeRaineye.section";

export class WorkspaceController implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<UiSnapshot>();
  private readonly connection: ConnectionManager;
  private adapter?: OpenCodeAdapter;
  private refreshTimer?: NodeJS.Timeout;
  private eventRetryTimer?: NodeJS.Timeout;
  private disposed = false;
  private snapshot: UiSnapshot;

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    readonly workspacePath: string,
    workspaceName: string,
  ) {
    const config = vscode.workspace.getConfiguration("opencodeRaineye");
    const defaultMode = config.get<ChatMode>("defaultMode", "craft");
    this.connection = new ConnectionManager(context, logger, workspacePath);
    this.snapshot = {
      section: context.workspaceState.get<ViewSection>(SECTION_KEY, "chat"),
      connection: this.connection.state,
      workspaceName,
      workspacePath,
      sessions: [],
      messages: [],
      busy: false,
      mode: defaultMode,
      selectedModel: context.workspaceState.get<string>(MODEL_KEY),
      selectedSkill: context.workspaceState.get<string>(SKILL_KEY),
      models: [],
      skills: [],
      agents: [],
      mcps: [],
      permissions: [],
      questions: [],
      diffs: [],
      settings: readSettings(),
    };

    context.subscriptions.push(
      this.connection.onDidChangeState((state) => {
        this.update({ connection: state });
      }),
      this.connection.onDidConnect((active) => void this.activateConnection(active)),
    );
  }

  get state(): UiSnapshot {
    return this.snapshot;
  }

  async start(): Promise<void> {
    await this.connection.discover();
  }

  async handle(message: WebviewToHostMessage): Promise<AttachmentView | undefined> {
    switch (message.type) {
      case "ready":
        this.emit();
        return;
      case "navigate":
        await this.navigate(message.section);
        return;
      case "reconnect":
        await this.connection.reconnect();
        return;
      case "start-server":
        await this.runWithError("启动 OpenCode 失败", () => this.connection.startManaged());
        return;
      case "connect-manual":
        await this.runWithError("连接 OpenCode 失败", () => this.connection.connectManual(message.host, message.port, message.password));
        return;
      case "new-session":
        await this.newSession();
        return;
      case "open-session":
        await this.openSession(message.sessionId);
        return;
      case "delete-session":
        await this.deleteSession(message.sessionId);
        return;
      case "send":
        await this.send(message.text, message.mode, message.model, message.skill, message.attachments);
        return;
      case "abort":
        await this.abort();
        return;
      case "select-file":
        return await this.selectFile();
      case "select-image":
        return await this.selectImage();
      case "open-file":
        await this.openFile(message.path, message.line);
        return;
      case "show-diff":
        await this.showDiff(message.file);
        return;
      case "reply-permission":
        await this.replyPermission(message.requestId, message.reply);
        return;
      case "reply-question":
        await this.replyQuestion(message.requestId, message.answers);
        return;
      case "reject-question":
        await this.rejectQuestion(message.requestId);
        return;
      case "save-settings":
        await this.saveSettings(message.settings);
        return;
      case "save-mcp":
        await this.saveMcp(message.mcp);
        return;
      case "connect-mcp":
        await this.mcpAction("连接 MCP 失败", (adapter) => adapter.connectMcp(message.name));
        return;
      case "disconnect-mcp":
        await this.mcpAction("断开 MCP 失败", (adapter) => adapter.disconnectMcp(message.name));
        return;
      case "authenticate-mcp":
        await this.mcpAction("MCP OAuth 认证失败", (adapter) => adapter.authenticateMcp(message.name));
        return;
      case "refresh":
        await this.refreshAll();
        return;
      case "open-tui":
        this.openTui();
        return;
      case "open-output":
        this.logger.show();
        return;
    }
  }

  async insertActiveFileReference(): Promise<AttachmentView | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return await this.selectFile();
    return referenceForUri(editor.document.uri, editor.selection, this.workspacePath);
  }

  async navigate(section: ViewSection): Promise<void> {
    this.update({ section });
    await this.context.workspaceState.update(SECTION_KEY, section);
    if (section === "history") await this.refreshSessions();
    if (section === "settings") await this.refreshMcps();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.eventRetryTimer) clearTimeout(this.eventRetryTimer);
    this.adapter?.dispose();
    this.connection.dispose();
    this.emitter.dispose();
  }

  private async activateConnection(active: ActiveConnection): Promise<void> {
    this.adapter?.dispose();
    const adapter = new OpenCodeAdapter(active.endpoint, active.password, this.workspacePath, this.logger);
    this.adapter = adapter;
    this.subscribe(adapter);
    await this.refreshAll();
  }

  private subscribe(adapter: OpenCodeAdapter): void {
    adapter.subscribe(
      (event) => this.onOpenCodeEvent(event),
      (error) => {
        if (this.adapter !== adapter) return;
        this.logger.warn("OpenCode event stream disconnected", error);
        if (this.eventRetryTimer) clearTimeout(this.eventRetryTimer);
        this.eventRetryTimer = setTimeout(() => {
          if (this.adapter === adapter) this.subscribe(adapter);
        }, 1_500);
      },
    );
  }

  private onOpenCodeEvent(value: unknown): void {
    const envelope = asRecord(value);
    if (!envelope) return;
    const eventDirectory = typeof envelope.directory === "string" ? envelope.directory : undefined;
    if (eventDirectory && !samePath(eventDirectory, this.workspacePath)) return;
    const payload = asRecord(envelope.payload) ?? envelope;
    const type = typeof payload.type === "string" ? payload.type : "";
    const properties = asRecord(payload.properties) ?? {};

    if (type === "session.idle") {
      this.update({ busy: false });
      void this.refreshDiff();
    }
    if (type === "session.status") {
      const status = asRecord(properties.status);
      if (status?.type === "idle") {
        this.update({ busy: false });
        void this.refreshDiff();
      }
      if (status?.type === "busy" || status?.type === "retry") this.update({ busy: true });
    }

    if (type.startsWith("message.") || type.startsWith("session.")) this.scheduleConversationRefresh();
    if (type.startsWith("permission.")) void this.refreshPending();
    if (type.startsWith("question.")) void this.refreshPending();
    if (type.startsWith("mcp.")) void this.refreshMcps();
    if (type === "server.connected" || type === "config.updated") void this.refreshCatalog();
  }

  private scheduleConversationRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void Promise.all([this.refreshSessions(), this.refreshMessages()]);
    }, 90);
  }

  private async refreshAll(): Promise<void> {
    if (!this.adapter) return;
    this.update({ error: undefined });
    const results = await Promise.allSettled([
      this.refreshSessions(),
      this.refreshCatalog(),
      this.refreshMcps(),
      this.refreshPending(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") this.logger.warn("OpenCode refresh failed", result.reason);
    }
    if (this.snapshot.currentSessionId) await this.refreshMessages();
    if (this.snapshot.currentSessionId) await this.refreshDiff();
  }

  private async refreshSessions(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const sessions = await adapter.listSessions();
    let currentSessionId = this.snapshot.currentSessionId;
    if (currentSessionId && !sessions.some((session) => session.id === currentSessionId)) currentSessionId = undefined;
    this.update({ sessions, currentSessionId });
  }

  private async refreshMessages(): Promise<void> {
    const adapter = this.adapter;
    const sessionId = this.snapshot.currentSessionId;
    if (!adapter || !sessionId) return;
    const messages = await adapter.getMessages(sessionId);
    this.update({ messages });
  }

  private async refreshDiff(): Promise<void> {
    const adapter = this.adapter;
    const sessionId = this.snapshot.currentSessionId;
    if (!adapter || !sessionId) return;
    this.update({ diffs: await adapter.getDiff(sessionId) });
  }

  private async refreshCatalog(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const catalog = await adapter.getCatalog();
    const availableModel = this.snapshot.selectedModel && catalog.models.some((model) => model.id === this.snapshot.selectedModel)
      ? this.snapshot.selectedModel
      : catalog.defaultModel;
    const availableSkill = this.snapshot.selectedSkill && catalog.skills.some((skill) => skill.name === this.snapshot.selectedSkill)
      ? this.snapshot.selectedSkill
      : undefined;
    this.update({
      models: catalog.models,
      skills: catalog.skills,
      agents: catalog.agents,
      selectedModel: availableModel,
      selectedSkill: availableSkill,
    });
  }

  private async refreshMcps(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    this.update({ mcps: await adapter.getMcps() });
  }

  private async refreshPending(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const pending = await adapter.getPending();
    this.update(pending);
  }

  private async newSession(): Promise<void> {
    const adapter = this.requireAdapter();
    const session = await this.runWithError("新建对话失败", () => adapter.createSession(this.snapshot.mode, this.snapshot.selectedModel));
    if (!session) return;
    this.update({ currentSessionId: session.id, messages: [], diffs: [], section: "chat", sessions: [session, ...this.snapshot.sessions] });
  }

  private async openSession(sessionId: string): Promise<void> {
    if (!this.snapshot.sessions.some((session) => session.id === sessionId)) return;
    this.update({ currentSessionId: sessionId, messages: [], diffs: [], section: "chat" });
    await this.refreshMessages();
    const adapter = this.requireAdapter();
    this.update({ diffs: await adapter.getDiff(sessionId) });
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const session = this.snapshot.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const answer = await vscode.window.showWarningMessage(`删除对话“${session.title}”？此操作无法撤销。`, { modal: true }, "删除");
    if (answer !== "删除") return;
    const wasCurrent = this.snapshot.currentSessionId === sessionId;
    const adapter = this.requireAdapter();
    await this.runWithError("删除对话失败", () => adapter.deleteSession(sessionId));
    await this.refreshSessions();
    if (wasCurrent) this.update({ currentSessionId: undefined, messages: [], diffs: [] });
  }

  private async send(text: string, mode: ChatMode, model: string | undefined, skill: string | undefined, attachments: AttachmentView[]): Promise<void> {
    if (!text.trim() && attachments.length === 0) return;
    const adapter = this.requireAdapter();
    let sessionId = this.snapshot.currentSessionId;
    if (!sessionId) {
      const session = await adapter.createSession(mode, model);
      sessionId = session.id;
      this.update({ currentSessionId: sessionId, sessions: [session, ...this.snapshot.sessions] });
    }
    this.update({ busy: true, mode, selectedModel: model, selectedSkill: skill, error: undefined });
    await Promise.all([
      this.context.workspaceState.update(MODEL_KEY, model),
      this.context.workspaceState.update(SKILL_KEY, skill),
    ]);
    try {
      await adapter.send({ sessionId, text, mode, model, skill, attachments });
      this.scheduleConversationRefresh();
    } catch (error) {
      this.update({ busy: false, error: readableError(error) });
      vscode.window.showErrorMessage(`发送失败：${readableError(error)}`);
    }
  }

  private async abort(): Promise<void> {
    const adapter = this.adapter;
    const sessionId = this.snapshot.currentSessionId;
    if (!adapter || !sessionId) return;
    await this.runWithError("停止对话失败", () => adapter.abort(sessionId));
    this.update({ busy: false });
  }

  private async selectFile(): Promise<AttachmentView | undefined> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: vscode.Uri.file(this.workspacePath),
      openLabel: "引用文件",
    });
    if (!picked?.[0]) return undefined;
    return referenceForUri(picked[0], undefined, this.workspacePath);
  }

  private async selectImage(): Promise<AttachmentView | undefined> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: vscode.Uri.file(this.workspacePath),
      filters: { "图片": ["png", "jpg", "jpeg", "gif", "webp"] },
      openLabel: "添加图片",
    });
    if (!picked?.[0]) return undefined;
    const stat = await vscode.workspace.fs.stat(picked[0]);
    if (stat.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB");
    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    const mime = imageMime(path.extname(picked[0].fsPath));
    return {
      id: randomId(),
      kind: "image",
      name: path.basename(picked[0].fsPath),
      path: picked[0].fsPath,
      mime,
      dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    };
  }

  private async openFile(filePath: string, line?: number): Promise<void> {
    const absolute = resolveInsideWorkspace(filePath, this.workspacePath);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
    const editor = await vscode.window.showTextDocument(document);
    if (line !== undefined) {
      const position = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private async showDiff(file: string): Promise<void> {
    const absolute = resolveInsideWorkspace(file, this.workspacePath);
    await vscode.commands.executeCommand("git.openChange", vscode.Uri.file(absolute));
  }

  private async replyPermission(requestId: string, reply: PermissionReply): Promise<void> {
    const adapter = this.requireAdapter();
    await this.runWithError("权限响应失败", () => adapter.replyPermission(requestId, reply));
    await this.refreshPending();
  }

  private async replyQuestion(requestId: string, answers: string[][]): Promise<void> {
    const adapter = this.requireAdapter();
    await this.runWithError("问题响应失败", () => adapter.replyQuestion(requestId, answers));
    await this.refreshPending();
  }

  private async rejectQuestion(requestId: string): Promise<void> {
    const adapter = this.requireAdapter();
    await this.runWithError("拒绝问题失败", () => adapter.rejectQuestion(requestId));
    await this.refreshPending();
  }

  private async saveSettings(settings: SettingsView): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("opencodeRaineye");
    await Promise.all([
      configuration.update("command", settings.command.trim(), vscode.ConfigurationTarget.Global),
      configuration.update("serverUrl", settings.serverUrl.trim(), vscode.ConfigurationTarget.Global),
      configuration.update("serverPort", settings.serverPort, vscode.ConfigurationTarget.Global),
      configuration.update("autoStart", settings.autoStart, vscode.ConfigurationTarget.Workspace),
      configuration.update("defaultMode", settings.defaultMode, vscode.ConfigurationTarget.Workspace),
    ]);
    this.update({ settings: readSettings(), mode: settings.defaultMode });
    vscode.window.showInformationMessage("RainEye 设置已保存");
  }

  private async saveMcp(mcp: McpInput): Promise<void> {
    const adapter = this.requireAdapter();
    await this.runWithError("保存 MCP 配置失败", () => adapter.saveMcp(mcp));
    await this.refreshMcps();
  }

  private async mcpAction(label: string, action: (adapter: OpenCodeAdapter) => Promise<void>): Promise<void> {
    const adapter = this.requireAdapter();
    await this.runWithError(label, () => action(adapter));
    await this.refreshMcps();
  }

  private openTui(): void {
    const active = this.connection.active;
    if (!active) {
      vscode.window.showWarningMessage("请先连接 OpenCode");
      return;
    }
    const config = vscode.workspace.getConfiguration("opencodeRaineye");
    const command = config.get<string>("command", "opencode");
    const env: Record<string, string> = { OPENCODE_CALLER: "vscode" };
    if (active.password) env.OPENCODE_SERVER_PASSWORD = active.password;
    const terminal = vscode.window.createTerminal({ name: "OpenCode TUI", cwd: this.workspacePath, env });
    terminal.show();
    terminal.sendText(`${quoteShell(command)} attach ${quoteShell(active.endpoint)}`);
  }

  private requireAdapter(): OpenCodeAdapter {
    if (!this.adapter) throw new Error("尚未连接 OpenCode");
    return this.adapter;
  }

  private async runWithError<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      const message = readableError(error);
      this.logger.error(label, error);
      this.update({ error: message });
      vscode.window.showErrorMessage(`${label}：${message}`);
      return undefined;
    }
  }

  private update(patch: Partial<UiSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    this.emitter.fire(this.snapshot);
  }
}

function readSettings(): SettingsView {
  const config = vscode.workspace.getConfiguration("opencodeRaineye");
  return {
    command: config.get<string>("command", "opencode"),
    serverUrl: config.get<string>("serverUrl", ""),
    serverPort: config.get<number>("serverPort", 4096),
    autoStart: config.get<boolean>("autoStart", false),
    defaultMode: config.get<ChatMode>("defaultMode", "craft"),
  };
}

function referenceForUri(uri: vscode.Uri, selection: vscode.Selection | undefined, workspacePath: string): AttachmentView {
  const relative = path.relative(workspacePath, uri.fsPath).replace(/\\/g, "/");
  const displayPath = relative && !relative.startsWith("..") ? relative : uri.fsPath.replace(/\\/g, "/");
  let reference = `@${displayPath}`;
  if (selection && !selection.isEmpty) {
    const start = selection.start.line + 1;
    const end = selection.end.line + 1;
    reference += start === end ? `#L${start}` : `#L${start}-L${end}`;
  }
  return { id: randomId(), kind: "reference", name: path.basename(uri.fsPath), path: uri.fsPath, reference };
}

function imageMime(extension: string): string {
  switch (extension.toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return "image/png";
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function resolveInsideWorkspace(filePath: string, workspacePath: string): string {
  const absolute = path.resolve(workspacePath, filePath);
  const relative = path.relative(workspacePath, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("拒绝打开工作区外的路径");
  }
  return absolute;
}

function quoteShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
