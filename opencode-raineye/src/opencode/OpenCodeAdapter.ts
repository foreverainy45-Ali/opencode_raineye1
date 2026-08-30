import {
  createOpencodeClient,
  type Agent,
  type Config,
  type FilePartInput,
  type McpLocalConfig,
  type McpRemoteConfig,
  type McpStatus,
  type Message,
  type Part,
  type PermissionRequest,
  type QuestionRequest,
  type Session,
  type SnapshotFileDiff,
} from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { createAuthenticatedFetch } from "../connection/ConnectionManager";
import {
  AgentOption,
  AttachmentView,
  ChatMode,
  DiffView,
  McpInput,
  McpServerView,
  ModelOption,
  PermissionReply,
  PermissionView,
  QuestionView,
  SessionSummary,
  SkillOption,
  UiMessage,
  UiMessagePart,
} from "../shared/protocol";
import { Logger } from "../services/Logger";

export interface Catalog {
  models: ModelOption[];
  defaultModel?: string;
  skills: SkillOption[];
  agents: AgentOption[];
}

export interface PendingRequests {
  permissions: PermissionView[];
  questions: QuestionView[];
}

export interface SendInput {
  sessionId: string;
  text: string;
  mode: ChatMode;
  model?: string;
  skill?: string;
  attachments: AttachmentView[];
}

export class OpenCodeAdapter {
  private readonly client: OpencodeClient;
  private eventAbort?: AbortController;
  private readonly sessionPresence = new Map<string, { updatedAt: number; hasMessages: boolean }>();

  constructor(
    endpoint: string,
    password: string | undefined,
    private readonly directory: string,
    private readonly logger: Logger,
  ) {
    this.client = createOpencodeClient({
      baseUrl: endpoint,
      directory,
      fetch: createAuthenticatedFetch(password),
      responseStyle: "fields",
      throwOnError: true,
    });
  }

  async listSessions(): Promise<SessionSummary[]> {
    const { data: sessions } = await this.client.session.list<true>({
      directory: this.directory,
      scope: "project",
      roots: true,
      limit: 200,
    });
    const normalized = sessions.map(normalizeSession);
    const withPresence = await mapLimited(normalized, 12, async (session) => {
      const cached = this.sessionPresence.get(session.id);
      if (cached?.hasMessages || cached?.updatedAt === session.updatedAt) {
        return { ...session, hasMessages: cached.hasMessages };
      }
      try {
        const response = await this.client.session.messages<true>({
          sessionID: session.id,
          directory: this.directory,
          limit: 1,
        });
        const hasMessages = response.data.length > 0;
        this.sessionPresence.set(session.id, { updatedAt: session.updatedAt, hasMessages });
        return { ...session, hasMessages };
      } catch (error) {
        this.logger.debug(`Unable to inspect session ${session.id}; retaining it in history`, error);
        return { ...session, hasMessages: true };
      }
    });
    return withPresence.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createSession(mode: ChatMode, model?: string): Promise<SessionSummary> {
    const modelRef = parseModel(model);
    const { data: session } = await this.client.session.create<true>({
      directory: this.directory,
      title: "新对话",
      agent: mode === "plan" ? "plan" : "build",
      model: modelRef ? { id: modelRef.modelID, providerID: modelRef.providerID } : undefined,
      permission: permissionRules(mode),
    });
    return normalizeSession(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.session.delete<true>({ sessionID: sessionId, directory: this.directory });
  }

  async getMessages(sessionId: string): Promise<UiMessage[]> {
    const { data: messages } = await this.client.session.messages<true>({
      sessionID: sessionId,
      directory: this.directory,
      limit: 500,
    });
    return messages.map(({ info, parts }) => normalizeMessage(info, parts));
  }

  async send(input: SendInput): Promise<void> {
    await this.client.session.update<true>({
      sessionID: input.sessionId,
      directory: this.directory,
      permission: permissionRules(input.mode),
    });
    const model = parseModel(input.model);
    const textReferences = input.attachments
      .filter((attachment) => attachment.kind === "reference" && attachment.reference)
      .map((attachment) => attachment.reference as string);
    const text = [...textReferences, input.text.trim()].filter(Boolean).join("\n\n");
    const parts: Array<{ type: "text"; text: string } | FilePartInput> = [{ type: "text", text }];
    for (const attachment of input.attachments) {
      if (attachment.kind !== "image" || !attachment.dataUrl || !attachment.mime) continue;
      parts.push({
        type: "file",
        mime: attachment.mime,
        filename: attachment.name,
        url: attachment.dataUrl,
      });
    }

    const skillInstruction = input.skill
      ? `Use the "${input.skill}" skill for this request. Load it with OpenCode's native skill tool before applying it.`
      : undefined;
    await this.client.session.promptAsync<true>({
      sessionID: input.sessionId,
      directory: this.directory,
      model,
      agent: input.mode === "plan" ? "plan" : "build",
      tools: input.mode === "plan"
        ? { edit: false, write: false, patch: false, bash: false }
        : undefined,
      system: skillInstruction,
      parts,
    });
  }

  async abort(sessionId: string): Promise<void> {
    await this.client.session.abort<true>({ sessionID: sessionId, directory: this.directory });
  }

  async getDiff(sessionId: string): Promise<DiffView[]> {
    const { data: diffs } = await this.client.session.diff<true>({ sessionID: sessionId, directory: this.directory });
    return diffs.map(normalizeDiff);
  }

  async getCatalog(): Promise<Catalog> {
    const [providerResponse, skillsResponse, agentsResponse] = await Promise.all([
      this.client.config.providers<true>({ directory: this.directory }),
      this.client.app.skills<true>({ directory: this.directory }),
      this.client.app.agents<true>({ directory: this.directory }),
    ]);
    const providerResult = providerResponse.data;
    const skills = skillsResponse.data;
    const agents = agentsResponse.data;

    const models: ModelOption[] = [];
    for (const provider of providerResult.providers) {
      for (const model of Object.values(provider.models)) {
        if (model.status === "deprecated") continue;
        models.push({
          id: `${provider.id}/${model.id}`,
          providerId: provider.id,
          name: model.name || model.id,
          providerName: provider.name || provider.id,
          supportsImages: Boolean(model.capabilities.input.image),
        });
      }
    }
    models.sort((a, b) => `${a.providerName}/${a.name}`.localeCompare(`${b.providerName}/${b.name}`));
    const defaultEntry = Object.entries(providerResult.default).find(([providerId, modelId]) =>
      models.some((model) => model.providerId === providerId && model.id === `${providerId}/${modelId}`),
    );

    return {
      models,
      defaultModel: defaultEntry ? `${defaultEntry[0]}/${defaultEntry[1]}` : models[0]?.id,
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        location: skill.location,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      agents: agents.map(normalizeAgent).filter((agent) => !agent.hidden),
    };
  }

  async getPending(): Promise<PendingRequests> {
    const [permissionResponse, questionResponse] = await Promise.all([
      this.client.permission.list<true>({ directory: this.directory }),
      this.client.question.list<true>({ directory: this.directory }),
    ]);
    const permissions = permissionResponse.data;
    const questions = questionResponse.data;
    return {
      permissions: permissions.map(normalizePermission),
      questions: questions.map(normalizeQuestion),
    };
  }

  async replyPermission(requestId: string, reply: PermissionReply): Promise<void> {
    await this.client.permission.reply<true>({ requestID: requestId, directory: this.directory, reply });
  }

  async replyQuestion(requestId: string, answers: string[][]): Promise<void> {
    await this.client.question.reply<true>({ requestID: requestId, directory: this.directory, answers });
  }

  async rejectQuestion(requestId: string): Promise<void> {
    await this.client.question.reject<true>({ requestID: requestId, directory: this.directory });
  }

  async getMcps(persistedProject: Config = {}, persistedGlobal: Config = {}): Promise<McpServerView[]> {
    const [projectResponse, globalResponse, statusResponse] = await Promise.all([
      this.client.config.get<true>({ directory: this.directory }),
      this.client.global.config.get<true>(),
      this.client.mcp.status<true>({ directory: this.directory }),
    ]);
    const projectConfig = projectResponse.data;
    const globalConfig = globalResponse.data;
    const statuses = statusResponse.data;
    const globalMcps = { ...configMcps(globalConfig), ...configMcps(persistedGlobal) };
    const projectMcps = configMcps(persistedProject);
    const effectiveMcps = { ...configMcps(projectConfig), ...projectMcps };
    const names = new Set([...Object.keys(globalMcps), ...Object.keys(effectiveMcps), ...Object.keys(statuses)]);
    return [...names].sort().map((name) => {
      const appearsGlobal = name in globalMcps && !(name in projectMcps);
      const config = effectiveMcps[name] ?? globalMcps[name];
      return normalizeMcp(name, config, statuses[name], appearsGlobal ? "global" : "project");
    });
  }

  async applyMcp(input: McpInput): Promise<void> {
    const { name, scope, ...config } = input;
    await this.client.mcp.add<true>({ directory: this.directory, name, config });
    const response = await this.client.mcp.status<true>({ directory: this.directory });
    const status = response.data[name];
    if (status?.status === "failed") throw new Error(`MCP 连接失败：${status.error}`);
  }

  async reloadInstance(): Promise<void> {
    await this.client.instance.dispose<true>({ directory: this.directory });
  }

  async connectMcp(name: string): Promise<void> {
    await this.client.mcp.connect<true>({ name, directory: this.directory });
  }

  async disconnectMcp(name: string): Promise<void> {
    await this.client.mcp.disconnect<true>({ name, directory: this.directory });
  }

  async reconnectMcp(name: string): Promise<void> {
    await this.client.mcp.disconnect<true>({ name, directory: this.directory });
    await this.client.mcp.connect<true>({ name, directory: this.directory });
  }

  async authenticateMcp(name: string): Promise<void> {
    await this.client.mcp.auth.authenticate<true>({ name, directory: this.directory });
  }

  subscribe(onEvent: (event: unknown) => void, onError: (error: unknown) => void): void {
    this.eventAbort?.abort();
    const controller = new AbortController();
    this.eventAbort = controller;
    void (async () => {
      try {
        const result = await this.client.global.event<true>({ signal: controller.signal });
        for await (const event of result.stream) {
          if (controller.signal.aborted) return;
          try {
            onEvent(event);
          } catch (error) {
            this.logger.warn("Failed to process OpenCode event", error);
          }
        }
        if (!controller.signal.aborted) onError(new Error("OpenCode event stream closed"));
      } catch (error) {
        if (!controller.signal.aborted) onError(error);
      }
    })();
  }

  dispose(): void {
    this.eventAbort?.abort();
    this.eventAbort = undefined;
  }
}

function normalizeSession(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.title || "新对话",
    directory: session.directory,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    archivedAt: session.time.archived,
    additions: session.summary?.additions,
    deletions: session.summary?.deletions,
    files: session.summary?.files,
  };
}

function normalizeMessage(info: Message, parts: Part[]): UiMessage {
  const isAssistant = info.role === "assistant";
  return {
    id: info.id,
    sessionId: info.sessionID,
    role: info.role,
    createdAt: info.time.created,
    completedAt: isAssistant ? info.time.completed : undefined,
    model: isAssistant ? `${info.providerID}/${info.modelID}` : `${info.model.providerID}/${info.model.modelID}`,
    agent: info.agent,
    error: isAssistant && info.error ? errorText(info.error) : undefined,
    parts: parts.map(normalizePart).filter((part): part is UiMessagePart => Boolean(part)),
  };
}

function normalizePart(part: Part): UiMessagePart | undefined {
  switch (part.type) {
    case "text":
      return { id: part.id, kind: "text", text: part.text };
    case "reasoning":
      return { id: part.id, kind: "reasoning", text: part.text };
    case "file":
      return { id: part.id, kind: "file", filename: part.filename, mime: part.mime, url: part.url };
    case "tool": {
      const state = part.state;
      return {
        id: part.id,
        kind: "tool",
        tool: {
          tool: part.tool,
          callId: part.callID,
          status: state.status,
          input: state.input,
          title: "title" in state ? state.title : undefined,
          output: state.status === "completed" ? state.output : undefined,
          error: state.status === "error" ? state.error : undefined,
        },
      };
    }
    case "patch":
      return { id: part.id, kind: "patch", text: part.files.join("\n") };
    case "retry":
      return { id: part.id, kind: "error", text: part.error.data.message };
    case "step-start":
      return { id: part.id, kind: "status", text: "开始执行" };
    case "step-finish":
      return { id: part.id, kind: "status", text: part.reason };
    default:
      return undefined;
  }
}

function normalizeAgent(agent: Agent): AgentOption {
  return {
    name: agent.name,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    native: agent.native,
  };
}

function normalizePermission(request: PermissionRequest): PermissionView {
  return {
    id: request.id,
    sessionId: request.sessionID,
    permission: request.permission,
    patterns: request.patterns,
    always: request.always,
    metadata: request.metadata,
  };
}

function normalizeQuestion(request: QuestionRequest): QuestionView {
  return {
    id: request.id,
    sessionId: request.sessionID,
    questions: request.questions.map((question) => ({
      question: question.question,
      header: question.header,
      multiple: question.multiple,
      options: question.options.map((option) => ({ label: option.label, description: option.description })),
    })),
  };
}

function normalizeDiff(diff: SnapshotFileDiff): DiffView {
  return {
    file: diff.file ?? "unknown",
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
  };
}

function parseModel(value?: string): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
}

function permissionRules(mode: ChatMode): Array<{ permission: string; pattern: string; action: "ask" | "deny" }> {
  const action = mode === "plan" ? "deny" : "ask";
  return [
    { permission: "edit", pattern: "*", action },
    { permission: "bash", pattern: "*", action },
  ];
}

function configMcps(config: Config): Record<string, McpLocalConfig | McpRemoteConfig | { enabled: boolean }> {
  return config.mcp ?? {};
}

function normalizeMcp(
  name: string,
  config: McpLocalConfig | McpRemoteConfig | { enabled: boolean } | undefined,
  status: McpStatus | undefined,
  scope: "project" | "global",
): McpServerView {
  const statusName = status?.status ?? "unknown";
  const detail = status && "error" in status ? status.error : undefined;
  if (config?.enabled !== undefined && !("type" in config)) {
    return { name, type: "local", enabled: config.enabled, status: statusName, detail, scope };
  }
  if (config?.type === "remote") {
    return {
      name,
      type: "remote",
      enabled: config.enabled !== false,
      status: statusName,
      detail,
      url: config.url,
      timeout: config.timeout,
      hasHeaders: Boolean(config.headers && Object.keys(config.headers).length),
      oauth: config.oauth === false ? "disabled" : config.oauth ? "configured" : "auto",
      scope,
    };
  }
  return {
    name,
    type: "local",
    enabled: config?.enabled !== false,
    status: statusName,
    detail,
    command: config && "command" in config ? config.command : undefined,
    cwd: config && "cwd" in config ? config.cwd : undefined,
    timeout: config && "timeout" in config ? config.timeout : undefined,
    hasEnvironment: Boolean(config && "environment" in config && config.environment && Object.keys(config.environment).length),
    scope,
  };
}

async function mapLimited<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function errorText(error: { name: string; data: unknown }): string {
  if (error.data && typeof error.data === "object" && "message" in error.data) {
    return String((error.data as { message: unknown }).message);
  }
  return error.name;
}
