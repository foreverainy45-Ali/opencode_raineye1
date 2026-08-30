export type ChatMode = "craft" | "plan";

export type ViewSection = "chat" | "history" | "settings";

export type ConnectionPhase =
  | "disconnected"
  | "discovering"
  | "starting"
  | "connecting"
  | "auth-required"
  | "connected"
  | "error";

export interface ConnectionState {
  phase: ConnectionPhase;
  endpoint?: string;
  source?: "configured" | "managed" | "remembered" | "terminal" | "mdns" | "listener" | "default" | "manual";
  version?: string;
  pid?: number;
  workspacePath?: string;
  message?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  directory: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  additions?: number;
  deletions?: number;
  files?: number;
  hasMessages?: boolean;
}

export type MessageRole = "user" | "assistant";

export type MessagePartKind =
  | "text"
  | "reasoning"
  | "tool"
  | "file"
  | "patch"
  | "error"
  | "status";

export interface UiToolPart {
  tool: string;
  callId?: string;
  status?: string;
  title?: string;
  input?: unknown;
  output?: string;
  error?: string;
}

export interface UiMessagePart {
  id: string;
  kind: MessagePartKind;
  text?: string;
  filename?: string;
  mime?: string;
  url?: string;
  tool?: UiToolPart;
}

export interface UiMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  createdAt: number;
  completedAt?: number;
  model?: string;
  agent?: string;
  error?: string;
  parts: UiMessagePart[];
}

export interface ModelOption {
  id: string;
  providerId: string;
  name: string;
  providerName: string;
  supportsImages: boolean;
}

export interface SkillOption {
  name: string;
  description?: string;
  location: string;
  registeredScope?: "project" | "global";
  registeredSource?: string;
}

export interface AgentOption {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
}

export type McpStatusName =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"
  | "unknown";

export interface McpServerView {
  name: string;
  type: "local" | "remote";
  enabled: boolean;
  status: McpStatusName;
  detail?: string;
  command?: string[];
  cwd?: string;
  url?: string;
  timeout?: number;
  hasEnvironment?: boolean;
  hasHeaders?: boolean;
  oauth?: "auto" | "disabled" | "configured";
  scope: "project" | "global";
}

export interface PermissionView {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  always: string[];
  metadata: Record<string, unknown>;
}

export interface QuestionChoice {
  label: string;
  description?: string;
}

export interface QuestionInfoView {
  question: string;
  header?: string;
  multiple?: boolean;
  options: QuestionChoice[];
}

export interface QuestionView {
  id: string;
  sessionId: string;
  questions: QuestionInfoView[];
}

export interface DiffView {
  file: string;
  patch?: string;
  before?: string;
  after?: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface AttachmentView {
  id: string;
  kind: "reference" | "image";
  name: string;
  path?: string;
  reference?: string;
  mime?: string;
  dataUrl?: string;
}

export interface FileSuggestion {
  path: string;
  name: string;
}

export interface SettingsView {
  command: string;
  serverUrl: string;
  serverPort: number;
  autoStart: boolean;
  mdnsDiscovery: boolean;
  mdnsDomain: string;
  defaultMode: ChatMode;
}

export interface UiSnapshot {
  section: ViewSection;
  connection: ConnectionState;
  workspaceName: string;
  workspacePath?: string;
  sessions: SessionSummary[];
  currentSessionId?: string;
  messages: UiMessage[];
  busy: boolean;
  mode: ChatMode;
  selectedModel?: string;
  selectedSkill?: string[];
  models: ModelOption[];
  skills: SkillOption[];
  agents: AgentOption[];
  mcps: McpServerView[];
  permissions: PermissionView[];
  questions: QuestionView[];
  diffs: DiffView[];
  settings: SettingsView;
  error?: string;
}

export type HostToWebviewMessage =
  | { type: "snapshot"; snapshot: UiSnapshot }
  | { type: "toast"; level: "info" | "warning" | "error"; message: string }
  | { type: "insert-reference"; attachment: AttachmentView }
  | { type: "file-suggestions"; requestId: number; query: string; files: FileSuggestion[] }
  | { type: "focus-composer" };

export interface LocalMcpInput {
  name: string;
  scope: "project" | "global";
  type: "local";
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface RemoteMcpInput {
  name: string;
  scope: "project" | "global";
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  oauth?: false | {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    callbackPort?: number;
    redirectUri?: string;
  };
  enabled?: boolean;
  timeout?: number;
}

export type McpInput = LocalMcpInput | RemoteMcpInput;

export interface SkillFolderInput {
  scope: "project" | "global";
  value: string;
}

export interface CustomModelInput {
  scope: "project" | "global";
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  baseUrl: string;
  apiKey?: string;
  npm: "@ai-sdk/openai-compatible" | "@ai-sdk/openai";
  contextLimit?: number;
  outputLimit?: number;
  supportsImages?: boolean;
  reasoning?: boolean;
}

export type PermissionReply = "once" | "always" | "reject";

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "navigate"; section: ViewSection }
  | { type: "reconnect" }
  | { type: "start-server" }
  | { type: "connect-manual"; host: string; port: number; password?: string }
  | { type: "new-session" }
  | { type: "open-session"; sessionId: string }
  | { type: "delete-session"; sessionId: string }
  | { type: "send"; text: string; mode: ChatMode; model?: string; skills?: string[]; attachments: AttachmentView[] }
  | { type: "abort" }
  | { type: "select-file" }
  | { type: "select-image" }
  | { type: "search-files"; requestId: number; query: string }
  | { type: "open-file"; path: string; line?: number }
  | { type: "show-diff"; file: string }
  | { type: "reply-permission"; requestId: string; reply: PermissionReply }
  | { type: "reply-question"; requestId: string; answers: string[][] }
  | { type: "reject-question"; requestId: string }
  | { type: "save-settings"; settings: SettingsView }
  | { type: "save-mcp"; mcp: McpInput }
  | { type: "select-skill-folder"; scope: "project" | "global" }
  | { type: "open-skill"; location: string }
  | { type: "reload-skills" }
  | { type: "delete-skill"; name: string; scope: "project" | "global"; source: string }
  | { type: "save-custom-model"; model: CustomModelInput }
  | { type: "connect-mcp"; name: string }
  | { type: "disconnect-mcp"; name: string }
  | { type: "reconnect-mcp"; name: string }
  | { type: "delete-mcp"; name: string; scope: "project" | "global" }
  | { type: "authenticate-mcp"; name: string }
  | { type: "refresh" }
  | { type: "open-tui" }
  | { type: "open-output" };

export function isWebviewMessage(value: unknown): value is WebviewToHostMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const type = message.type;
  if (typeof type !== "string") return false;
  switch (type) {
    case "ready":
    case "reconnect":
    case "start-server":
    case "new-session":
    case "abort":
    case "select-file":
    case "select-image":
    case "refresh":
    case "open-tui":
    case "open-output":
    case "reload-skills":
      return true;
    case "select-skill-folder":
      return message.scope === "project" || message.scope === "global";
    case "open-skill":
      return typeof message.location === "string" && message.location.length > 0;
    case "delete-skill":
      return typeof message.name === "string" && message.name.length > 0
        && (message.scope === "project" || message.scope === "global")
        && typeof message.source === "string" && message.source.length > 0;
    case "search-files":
      return Number.isInteger(message.requestId)
        && Number(message.requestId) >= 0
        && typeof message.query === "string"
        && message.query.length <= 256;
    case "navigate":
      return message.section === "chat" || message.section === "history" || message.section === "settings";
    case "connect-manual":
      return typeof message.host === "string" && isPort(message.port) && optionalString(message.password);
    case "open-session":
    case "delete-session":
      return typeof message.sessionId === "string" && message.sessionId.length > 0;
    case "send":
      return typeof message.text === "string"
        && message.text.length <= 2_000_000
        && (message.mode === "craft" || message.mode === "plan")
        && optionalString(message.model)
        && optionalSkillSelection(message.skills)
        && Array.isArray(message.attachments)
        && message.attachments.length <= 20
        && message.attachments.every(isAttachment);
    case "open-file":
      return typeof message.path === "string" && optionalNumber(message.line);
    case "show-diff":
      return typeof message.file === "string";
    case "reply-permission":
      return typeof message.requestId === "string" && ["once", "always", "reject"].includes(String(message.reply));
    case "reply-question":
      return typeof message.requestId === "string"
        && Array.isArray(message.answers)
        && message.answers.every((answer) => Array.isArray(answer) && answer.every((item) => typeof item === "string"));
    case "reject-question":
      return typeof message.requestId === "string";
    case "save-settings":
      return isSettings(message.settings);
    case "save-mcp":
      return isMcp(message.mcp);
    case "save-custom-model":
      return isCustomModelInput(message.model);
    case "connect-mcp":
    case "disconnect-mcp":
    case "reconnect-mcp":
    case "authenticate-mcp":
      return typeof message.name === "string" && message.name.length > 0;
    case "delete-mcp":
      return typeof message.name === "string"
        && message.name.length > 0
        && (message.scope === "project" || message.scope === "global");
    default:
      return false;
  }
}

function isAttachment(value: unknown): value is AttachmentView {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return false;
  if (item.kind === "reference") return optionalString(item.path) && typeof item.reference === "string";
  if (item.kind === "image") {
    return optionalString(item.path)
      && typeof item.mime === "string"
      && item.mime.startsWith("image/")
      && typeof item.dataUrl === "string"
      && item.dataUrl.startsWith("data:image/")
      && item.dataUrl.length <= 15_000_000;
  }
  return false;
}

function isSettings(value: unknown): value is SettingsView {
  if (!value || typeof value !== "object") return false;
  const settings = value as Record<string, unknown>;
  return typeof settings.command === "string"
    && typeof settings.serverUrl === "string"
    && isPort(settings.serverPort)
    && typeof settings.autoStart === "boolean"
    && typeof settings.mdnsDiscovery === "boolean"
    && typeof settings.mdnsDomain === "string"
    && (settings.defaultMode === "craft" || settings.defaultMode === "plan");
}

function isMcp(value: unknown): value is McpInput {
  if (!value || typeof value !== "object") return false;
  const mcp = value as Record<string, unknown>;
  if (typeof mcp.name !== "string" || !mcp.name.trim()) return false;
  if (mcp.scope !== "project" && mcp.scope !== "global") return false;
  if (mcp.type === "local") return Array.isArray(mcp.command) && mcp.command.length > 0 && mcp.command.every((item) => typeof item === "string");
  if (mcp.type === "remote") {
    if (typeof mcp.url !== "string") return false;
    try {
      const url = new URL(mcp.url);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }
  return false;
}

function isCustomModelInput(value: unknown): value is CustomModelInput {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  return (model.scope === "project" || model.scope === "global")
    && typeof model.providerId === "string"
    && /^[a-zA-Z0-9._-]+$/.test(model.providerId)
    && model.providerId.length <= 128
    && typeof model.providerName === "string"
    && model.providerName.trim().length > 0
    && typeof model.modelId === "string"
    && model.modelId.trim().length > 0
    && model.modelId.length <= 256
    && typeof model.modelName === "string"
    && model.modelName.trim().length > 0
    && typeof model.baseUrl === "string"
    && isHttpUrl(model.baseUrl)
    && optionalString(model.apiKey)
    && (model.npm === "@ai-sdk/openai-compatible" || model.npm === "@ai-sdk/openai")
    && optionalPositiveInteger(model.contextLimit)
    && optionalPositiveInteger(model.outputLimit)
    && (model.supportsImages === undefined || typeof model.supportsImages === "boolean")
    && (model.reasoning === undefined || typeof model.reasoning === "boolean");
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) > 0);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalSkillSelection(value: unknown): boolean {
  return value === undefined || (Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 128));
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isPort(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535;
}
