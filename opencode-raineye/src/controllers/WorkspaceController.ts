import * as path from "node:path";
import * as vscode from "vscode";
import { ConnectionManager, type ActiveConnection } from "../connection/ConnectionManager";
import { buildCustomProviderConfig } from "../opencode/CustomProviderConfig";
import { OpenCodeConfigStore, type ConfigScope } from "../opencode/OpenCodeConfigStore";
import { OpenCodeAdapter } from "../opencode/OpenCodeAdapter";
import { findRootSkillManifest, skillDirectoryPath, skillSourcePath } from "../opencode/SkillDirectory";
import { Logger } from "../services/Logger";
import {
  AttachmentView,
  ChatMode,
  CustomModelInput,
  FileSuggestion,
  HostToWebviewMessage,
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
  private readonly configStore: OpenCodeConfigStore;
  private adapter?: OpenCodeAdapter;
  private refreshTimer?: NodeJS.Timeout;
  private eventRetryTimer?: NodeJS.Timeout;
  private workspaceFileCache?: { loadedAt: number; files: FileSuggestion[] };
  private disposed = false;
  private legacyMigrationChecked = false;
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
    this.configStore = new OpenCodeConfigStore(workspacePath);
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

  async handle(message: WebviewToHostMessage): Promise<HostToWebviewMessage | undefined> {
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
        return attachmentMessage(await this.selectFile());
      case "select-image":
        return attachmentMessage(await this.selectImage());
      case "search-files":
        return {
          type: "file-suggestions",
          requestId: message.requestId,
          query: message.query,
          files: await this.searchWorkspaceFiles(message.query),
        };
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
      case "select-skill-folder":
        await this.selectSkillFolder(message.scope);
        return;
      case "open-skill":
        await this.openSkill(message.location);
        return;
      case "reload-skills":
        await this.reloadSkills();
        return;
      case "delete-skill":
        await this.deleteSkill(message.name, message.scope, message.source);
        return;
      case "save-custom-model":
        await this.saveCustomModel(message.model);
        return;
      case "connect-mcp":
        await this.mcpAction("连接 MCP 失败", (adapter) => adapter.connectMcp(message.name));
        return;
      case "disconnect-mcp":
        await this.mcpAction("断开 MCP 失败", (adapter) => adapter.disconnectMcp(message.name));
        return;
      case "reconnect-mcp":
        await this.mcpAction("重连 MCP 失败", (adapter) => adapter.reconnectMcp(message.name));
        return;
      case "delete-mcp":
        await this.deleteMcp(message.name, message.scope);
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
    if (section === "settings") {
      await this.maybeMigrateLegacyConfigs();
      await Promise.all([this.refreshCatalog(), this.refreshMcps()]);
    }
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
    const [catalog, registrations] = await Promise.all([
      adapter.getCatalog(),
      this.configStore.listSkillRegistrations().catch((error) => {
        this.logger.warn("Failed to read configured Skill paths", error);
        return [];
      }),
    ]);
    const skills = catalog.skills.map((skill) => {
      const registration = registrations.find((item) => samePath(item.resolvedPath, skillDirectoryPath(skill.location)));
      return registration ? {
        ...skill,
        registeredScope: registration.scope,
        registeredSource: registration.source,
      } : skill;
    });
    const availableModel = this.snapshot.selectedModel && catalog.models.some((model) => model.id === this.snapshot.selectedModel)
      ? this.snapshot.selectedModel
      : catalog.defaultModel;
    const availableSkill = this.snapshot.selectedSkill && skills.some((skill) => skill.name === this.snapshot.selectedSkill)
      ? this.snapshot.selectedSkill
      : undefined;
    this.update({
      models: catalog.models,
      skills,
      agents: catalog.agents,
      selectedModel: availableModel,
      selectedSkill: availableSkill,
    });
  }

  private async refreshMcps(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const [project, global] = await Promise.all([
      this.configStore.read("project").catch((error) => {
        this.logger.warn("Failed to read project OpenCode config", error);
        return {};
      }),
      this.configStore.read("global").catch((error) => {
        this.logger.warn("Failed to read global OpenCode config", error);
        return {};
      }),
    ]);
    this.update({ mcps: await adapter.getMcps(project, global) });
  }

  private async refreshPending(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    const pending = await adapter.getPending();
    this.update(pending);
  }

  private async newSession(): Promise<void> {
    this.requireAdapter();
    this.update({ currentSessionId: undefined, messages: [], diffs: [], section: "chat" });
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
    let createdForSend = false;
    if (!sessionId) {
      const session = await adapter.createSession(mode, model);
      sessionId = session.id;
      createdForSend = true;
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
      if (createdForSend) {
        await adapter.deleteSession(sessionId).catch((cleanupError) => this.logger.warn("Failed to remove empty session", cleanupError));
        this.update({
          currentSessionId: undefined,
          sessions: this.snapshot.sessions.filter((session) => session.id !== sessionId),
        });
      }
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

  private async searchWorkspaceFiles(query: string): Promise<FileSuggestion[]> {
    const now = Date.now();
    if (!this.workspaceFileCache || now - this.workspaceFileCache.loadedAt > 5_000) {
      const uris = await vscode.workspace.findFiles(
        "**/*",
        "**/{.git,node_modules,.svn,.hg,dist,build,out,.next,.cache}/**",
        5_000,
      );
      const files = uris.flatMap((uri): FileSuggestion[] => {
        const relative = path.relative(this.workspacePath, uri.fsPath);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return [];
        const normalized = relative.replace(/\\/g, "/");
        return [{ path: normalized, name: path.basename(normalized) }];
      });
      this.workspaceFileCache = { loadedAt: now, files };
    }

    const normalizedQuery = query.trim().replace(/\\/g, "/").toLocaleLowerCase();
    return this.workspaceFileCache.files
      .map((file) => ({ file, score: fileSuggestionScore(file, normalizedQuery) }))
      .filter((item) => item.score < 100)
      .sort((left, right) => left.score - right.score || left.file.path.localeCompare(right.file.path))
      .slice(0, 30)
      .map((item) => item.file);
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
      configuration.update("mdnsDiscovery", settings.mdnsDiscovery, vscode.ConfigurationTarget.Workspace),
      configuration.update("mdnsDomain", settings.mdnsDomain.trim() || "opencode.local", vscode.ConfigurationTarget.Workspace),
      configuration.update("defaultMode", settings.defaultMode, vscode.ConfigurationTarget.Workspace),
    ]);
    this.update({ settings: readSettings(), mode: settings.defaultMode });
    vscode.window.showInformationMessage("RainEye 设置已保存");
  }

  private async saveMcp(mcp: McpInput): Promise<void> {
    const adapter = this.requireAdapter();
    const normalized = mcp.type === "local" ? await this.validateLocalMcp(mcp) : mcp;
    const saved = await this.runWithError("保存 MCP 配置失败", async () => {
      const { name, scope, ...config } = normalized;
      await this.configStore.upsertMcp(scope, name, config);
      const persisted = (await this.configStore.read(scope)).mcp?.[name];
      if (!persisted || !("type" in persisted)) throw new Error(`无法从官方配置读取 MCP “${name}”`);
      await adapter.applyMcp({ name, scope, ...persisted });
      return true;
    });
    if (!saved) return;
    await this.refreshMcps();
    vscode.window.showInformationMessage(`MCP “${mcp.name}” 已写入 OpenCode 并尝试连接。`);
  }

  private async selectSkillFolder(scope: "project" | "global"): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: false,
      canSelectFolders: true,
      defaultUri: vscode.Uri.file(this.workspacePath),
      openLabel: "添加所选 Skill 文件夹",
      title: "选择一个或多个根目录包含 SKILL.md 的文件夹",
    });
    if (!picked?.length) return;

    const inspected = await Promise.all(picked.map(async (uri) => {
      try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const manifest = findRootSkillManifest(entries.map(([name, type]) => [name, Boolean(type & vscode.FileType.File)]));
        return manifest ? { uri, source: skillSourcePath(uri.fsPath, this.workspacePath, scope) } : { uri };
      } catch {
        return { uri };
      }
    }));
    const valid = inspected.filter((item): item is { uri: vscode.Uri; source: string } => Boolean(item.source));
    const invalid = inspected.filter((item) => !item.source).map((item) => item.uri.fsPath);
    if (invalid.length) {
      vscode.window.showWarningMessage(`已跳过 ${invalid.length} 个无效 Skill 文件夹（根目录必须包含 SKILL.md）：${invalid.join("；")}`);
    }
    if (!valid.length) return;

    const adapter = this.requireAdapter();
    const saved = await this.runWithError("保存 Skill 文件夹失败", async () => {
      await this.configStore.addSkillPaths(scope, valid.map((item) => item.source));
      await adapter.reloadInstance();
      return true;
    });
    if (!saved) return;
    await this.refreshCatalog();
    vscode.window.showInformationMessage(`已注册 ${valid.length} 个 Skill 文件夹，OpenCode 配置已重新加载。`);
  }

  private async openSkill(location: string): Promise<void> {
    const skill = this.snapshot.skills.find((item) => item.location === location);
    if (!skill) return;
    let uri = vscode.Uri.file(skill.location);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory) {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const manifest = findRootSkillManifest(entries.map(([name, type]) => [name, Boolean(type & vscode.FileType.File)]));
      if (!manifest) throw new Error(`Skill 文件夹根目录没有 SKILL.md：${skill.location}`);
      uri = vscode.Uri.joinPath(uri, manifest);
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  }

  private async reloadSkills(): Promise<void> {
    const adapter = this.requireAdapter();
    const reloaded = await this.runWithError("重新加载 Skill 失败", async () => {
      await adapter.reloadInstance();
      return true;
    });
    if (!reloaded) return;
    await this.refreshCatalog();
    vscode.window.showInformationMessage("Skill 已重新加载");
  }

  private async deleteSkill(name: string, scope: ConfigScope, source: string): Promise<void> {
    const skill = this.snapshot.skills.find((item) => item.name === name
      && item.registeredScope === scope
      && item.registeredSource === source);
    if (!skill) return;
    const answer = await vscode.window.showWarningMessage(
      `从 ${scope === "global" ? "全局" : "项目"} OpenCode 配置移除 Skill “${name}”？磁盘上的文件夹不会被删除。`,
      { modal: true },
      "移除配置",
    );
    if (answer !== "移除配置") return;
    const adapter = this.requireAdapter();
    const deleted = await this.runWithError("移除 Skill 配置失败", async () => {
      await this.configStore.deleteSkillPath(scope, source);
      await adapter.reloadInstance();
      return true;
    });
    if (!deleted) return;
    await this.refreshCatalog();
    vscode.window.showInformationMessage(`Skill “${name}” 已从 OpenCode 配置移除，原文件夹仍保留。`);
  }

  private async validateLocalMcp(mcp: Extract<McpInput, { type: "local" }>): Promise<Extract<McpInput, { type: "local" }>> {
    const cwd = path.resolve(this.workspacePath, mcp.cwd?.trim() || ".");
    let cwdStat: vscode.FileStat;
    try {
      cwdStat = await vscode.workspace.fs.stat(vscode.Uri.file(cwd));
    } catch {
      throw new Error(`MCP 工作目录不存在：${cwd}`);
    }
    if (!(cwdStat.type & vscode.FileType.Directory)) throw new Error(`MCP 工作目录不是文件夹：${cwd}`);

    const pythonScript = mcp.command.find((argument) => /\.py$/i.test(argument));
    if (pythonScript) {
      const scriptPath = path.isAbsolute(pythonScript) ? path.normalize(pythonScript) : path.resolve(cwd, pythonScript);
      let scriptStat: vscode.FileStat;
      try {
        scriptStat = await vscode.workspace.fs.stat(vscode.Uri.file(scriptPath));
      } catch {
        throw new Error(`MCP Python 脚本不存在：${scriptPath}。请检查命令或工作目录。`);
      }
      if (!(scriptStat.type & vscode.FileType.File)) throw new Error(`MCP Python 脚本不是文件：${scriptPath}`);
    }
    return { ...mcp, cwd };
  }

  private async saveCustomModel(model: CustomModelInput): Promise<void> {
    const adapter = this.requireAdapter();
    const saved = await this.runWithError("保存自定义模型失败", async () => {
      const current = await this.configStore.read(model.scope);
      const provider = buildCustomProviderConfig(current.provider?.[model.providerId], model);
      await this.configStore.upsertProvider(model.scope, model.providerId.trim(), provider);
      await adapter.reloadInstance();
      return true;
    });
    if (!saved) return;
    await this.refreshCatalog();
    vscode.window.showInformationMessage(`自定义模型 ${model.providerId}/${model.modelId} 已写入官方配置并重新加载。`);
  }

  private async deleteMcp(name: string, scope: ConfigScope): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `删除 MCP “${name}”？将从 ${scope === "global" ? "全局" : "项目"} OpenCode 配置中移除。`,
      { modal: true },
      "删除",
    );
    if (answer !== "删除") return;
    const adapter = this.requireAdapter();
    const deleted = await this.runWithError("删除 MCP 失败", async () => {
      await this.configStore.deleteMcp(scope, name);
      await adapter.reloadInstance();
      return true;
    });
    if (!deleted) return;
    await this.refreshMcps();
    vscode.window.showInformationMessage(`MCP “${name}” 已删除。`);
  }

  private async maybeMigrateLegacyConfigs(): Promise<void> {
    if (this.legacyMigrationChecked || !this.adapter) return;
    this.legacyMigrationChecked = true;
    const infos = (await Promise.all([
      this.configStore.detectLegacy("project").catch((error) => {
        this.logger.warn("Failed to inspect legacy project OpenCode config", error);
        return undefined;
      }),
      this.configStore.detectLegacy("global").catch((error) => {
        this.logger.warn("Failed to inspect legacy global OpenCode config", error);
        return undefined;
      }),
    ])).filter((info) => info !== undefined);
    if (!infos.length) return;
    const details = infos.map((info) => `${info.scope === "global" ? "全局" : "项目"} ${info.path}`).join("\n");
    const answer = await vscode.window.showWarningMessage(
      `检测到旧版 RainEye 写入的 config.json，OpenCode 重启不会加载它：\n${details}\n是否迁移到官方 opencode.json？`,
      { modal: true },
      "迁移",
    );
    if (answer !== "迁移") return;
    const targets: string[] = [];
    for (const info of infos) targets.push(await this.configStore.migrateLegacy(info));
    await this.adapter.reloadInstance();
    vscode.window.showInformationMessage(`旧配置已迁移：${targets.join("，")}`);
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
    mdnsDiscovery: config.get<boolean>("mdnsDiscovery", false),
    mdnsDomain: config.get<string>("mdnsDomain", "opencode.local"),
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

function attachmentMessage(attachment: AttachmentView | undefined): HostToWebviewMessage | undefined {
  return attachment ? { type: "insert-reference", attachment } : undefined;
}

function fileSuggestionScore(file: FileSuggestion, query: string): number {
  if (!query) return 10;
  const filePath = file.path.toLocaleLowerCase();
  const name = file.name.toLocaleLowerCase();
  if (filePath === query || name === query) return 0;
  if (filePath.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (filePath.includes(`/${query}`)) return 3;
  if (filePath.includes(query)) return 4;
  const terms = query.split(/[\\/._-]+/).filter(Boolean);
  return terms.length && terms.every((term) => filePath.includes(term)) ? 5 : 100;
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
