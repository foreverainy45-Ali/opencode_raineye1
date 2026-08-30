import { FormEvent, useEffect, useState } from "react";
import type { ConnectionState, CustomModelInput, McpInput, McpServerView, ModelOption, SettingsView, SkillOption } from "../../shared/protocol";
import { post } from "../vscode";

export function Settings({
  settings: initial,
  connection,
  mcps,
  skills,
  models,
  workspacePath,
}: {
  settings: SettingsView;
  connection: ConnectionState;
  mcps: McpServerView[];
  skills: SkillOption[];
  models: ModelOption[];
  workspacePath?: string;
}): React.JSX.Element {
  const [settings, setSettings] = useState(initial);
  const [editingMcp, setEditingMcp] = useState<McpServerView>();
  useEffect(() => setSettings(initial), [initial]);
  return (
    <main className="page settings-page">
      <div className="page-heading"><div><h2>设置</h2><p>RainEye 与 OpenCode 官方配置</p></div><button onClick={() => post({ type: "open-output" })}>查看日志</button></div>
      <section className="settings-card">
        <div className="section-title"><div><h3>OpenCode 连接</h3><p>自动发现优先；也可以指定默认地址或命令。</p></div><StatusPill connection={connection} /></div>
        <div className="form-grid">
          <label className="wide">OpenCode 命令<input value={settings.command} onChange={(event) => setSettings({ ...settings, command: event.target.value })} placeholder="opencode 或绝对路径" /></label>
          <label>默认 URL<input value={settings.serverUrl} onChange={(event) => setSettings({ ...settings, serverUrl: event.target.value })} placeholder="留空自动发现" /></label>
          <label>默认端口<input type="number" min={1} max={65535} value={settings.serverPort} onChange={(event) => setSettings({ ...settings, serverPort: Number(event.target.value) })} /></label>
          <label>默认模式<select value={settings.defaultMode} onChange={(event) => setSettings({ ...settings, defaultMode: event.target.value as "craft" | "plan" })}><option value="craft">Craft</option><option value="plan">Plan</option></select></label>
          <label className="check"><input type="checkbox" checked={settings.autoStart} onChange={(event) => setSettings({ ...settings, autoStart: event.target.checked })} />未发现时自动新建进程</label>
          <label className="check"><input type="checkbox" checked={settings.mdnsDiscovery} onChange={(event) => setSettings({ ...settings, mdnsDiscovery: event.target.checked })} />启用可选 mDNS 发现</label>
          {settings.mdnsDiscovery && <label className="wide">mDNS 域名<input value={settings.mdnsDomain} onChange={(event) => setSettings({ ...settings, mdnsDomain: event.target.value })} placeholder="opencode.local" /></label>}
        </div>
        <div className="settings-actions"><button onClick={() => post({ type: "open-tui" })}>打开官方 TUI</button><button className="primary" onClick={() => post({ type: "save-settings", settings })}>保存设置</button></div>
      </section>

      <section className="settings-card">
        <div className="section-title"><div><h3>自定义模型</h3><p>写入 OpenCode 官方 provider 配置；保存后会出现在聊天模型选择器中。</p></div><span className="count">{models.length}</span></div>
        <CustomModelForm />
      </section>

      <section className="settings-card">
        <div className="section-title"><div><h3>MCP</h3><p>配置直接写入 OpenCode；远程连接由官方运行时自动尝试 HTTP 与 SSE。</p></div><span className="count">{mcps.length}</span></div>
        <div className="mcp-list">
          {mcps.map((mcp) => <McpRow key={`${mcp.scope}-${mcp.name}`} mcp={mcp} onEdit={() => setEditingMcp(mcp)} />)}
          {!mcps.length && <div className="empty-list">尚未配置 MCP Server</div>}
        </div>
        <McpForm
          key={editingMcp ? `${editingMcp.scope}-${editingMcp.name}` : "new"}
          workspacePath={workspacePath}
          initial={editingMcp}
          onClose={() => setEditingMcp(undefined)}
        />
      </section>

      <section className="settings-card">
        <div className="section-title"><div><h3>Skills</h3><p>选择根目录包含 SKILL.md 的文件夹，由 OpenCode 原生扫描与加载。</p></div><span className="count">{skills.length}</span></div>
        <div className="skill-list">
          {skills.slice(0, 30).map((skill) => <div key={skill.name}><strong>{skill.name}</strong><span>{skill.description}</span><code>{skill.location}</code></div>)}
          {!skills.length && <div className="empty-list">未发现 Skill。可在 .opencode/skills、.agents/skills 等官方目录添加。</div>}
        </div>
        <SkillFolderPicker />
      </section>
    </main>
  );
}

function CustomModelForm(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"project" | "global">("project");
  const [providerId, setProviderId] = useState("custom-openai");
  const [providerName, setProviderName] = useState("Custom OpenAI");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [npm, setNpm] = useState<CustomModelInput["npm"]>("@ai-sdk/openai-compatible");
  const [contextLimit, setContextLimit] = useState("");
  const [outputLimit, setOutputLimit] = useState("");
  const [supportsImages, setSupportsImages] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!/^[a-zA-Z0-9._-]+$/.test(providerId)) throw new Error("Provider ID 只能包含字母、数字、点、下划线和连字符");
      if (!providerName.trim() || !modelId.trim() || !modelName.trim()) throw new Error("请填写 Provider 名称、Model ID 和模型名称");
      const endpoint = new URL(baseUrl);
      if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("Base URL 必须使用 HTTP 或 HTTPS");
      const context = optionalPositiveNumber(contextLimit, "上下文长度");
      const output = optionalPositiveNumber(outputLimit, "最大输出");
      post({
        type: "save-custom-model",
        model: {
          scope,
          providerId: providerId.trim(),
          providerName: providerName.trim(),
          modelId: modelId.trim(),
          modelName: modelName.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          npm,
          contextLimit: context,
          outputLimit: output,
          supportsImages,
          reasoning,
        },
      });
      setError("");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (!open) return <button className="add-mcp" onClick={() => setOpen(true)}>＋ 添加自定义模型</button>;
  return (
    <form className="mcp-form" onSubmit={submit}>
      <div className="section-title"><h4>OpenAI-compatible Provider</h4><button type="button" className="icon-button" onClick={() => setOpen(false)}>×</button></div>
      <div className="form-grid">
        <label>作用域<select value={scope} onChange={(event) => setScope(event.target.value as "project" | "global")}><option value="project">当前项目</option><option value="global">全局</option></select></label>
        <label>API 类型<select value={npm} onChange={(event) => setNpm(event.target.value as CustomModelInput["npm"])}><option value="@ai-sdk/openai-compatible">Chat Completions compatible</option><option value="@ai-sdk/openai">OpenAI Responses</option></select></label>
        <label>Provider ID<input value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="custom-openai" /></label>
        <label>Provider 名称<input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="My Provider" /></label>
        <label>Model ID<input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="model-id-from-api" /></label>
        <label>模型名称<input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="My Model" /></label>
        <label className="wide">Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://gateway.example/v1" /></label>
        <label className="wide">API Key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="原始 key、{env:CUSTOM_API_KEY} 或 {file:~/.secrets/key}" /><small>值直接交给 OpenCode 的 provider.options.apiKey；使用 env/file 表达式可避免明文写入配置。</small></label>
        <label>上下文长度（可选）<input type="number" min={1} value={contextLimit} onChange={(event) => setContextLimit(event.target.value)} placeholder="128000" /></label>
        <label>最大输出（可选）<input type="number" min={1} value={outputLimit} onChange={(event) => setOutputLimit(event.target.value)} placeholder="16384" /></label>
        <label className="check"><input type="checkbox" checked={supportsImages} onChange={(event) => setSupportsImages(event.target.checked)} />支持图片输入</label>
        <label className="check"><input type="checkbox" checked={reasoning} onChange={(event) => setReasoning(event.target.checked)} />支持 Reasoning</label>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="settings-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button className="primary" type="submit">保存到 OpenCode</button></div>
    </form>
  );
}

function SkillFolderPicker(): React.JSX.Element {
  const [scope, setScope] = useState<"project" | "global">("project");
  return (
    <div className="mcp-form skill-folder-picker">
      <div className="form-grid">
        <label>作用域<select value={scope} onChange={(event) => setScope(event.target.value as "project" | "global")}><option value="project">当前项目</option><option value="global">全局</option></select></label>
        <label className="wide"><small>只注册所选文件夹，不复制或修改其中内容；根目录必须存在 OpenCode 官方文件名 SKILL.md。</small></label>
      </div>
      <button className="add-mcp" onClick={() => post({ type: "select-skill-folder", scope })}>选择 Skill 文件夹…</button>
    </div>
  );
}

function StatusPill({ connection }: { connection: ConnectionState }): React.JSX.Element {
  return <span className={`status-pill ${connection.phase}`}><i />{connection.phase === "connected" ? connection.message : connection.phase}</span>;
}

function McpRow({ mcp, onEdit }: { mcp: McpServerView; onEdit(): void }): React.JSX.Element {
  return (
    <div className="mcp-row">
      <div className={`mcp-status ${mcp.status}`} />
      <div className="mcp-info"><strong>{mcp.name}</strong><span>{mcp.type === "local" ? mcp.command?.join(" ") || "本地命令" : mcp.url}</span><small>{mcp.scope === "global" ? "全局" : "项目"} · {mcp.status}{mcp.cwd ? ` · cwd ${mcp.cwd}` : ""}{mcp.detail ? ` · ${mcp.detail}` : ""}</small></div>
      <details className="mcp-menu">
        <summary title="MCP 操作" aria-label="MCP 操作">⋯</summary>
        <div>
          <button onClick={onEdit}>编辑</button>
          <button onClick={() => post({ type: "reconnect-mcp", name: mcp.name })}>重连</button>
          {mcp.status === "connected"
            ? <button onClick={() => post({ type: "disconnect-mcp", name: mcp.name })}>断开</button>
            : <button onClick={() => post({ type: "connect-mcp", name: mcp.name })}>连接</button>}
          {(mcp.status === "needs_auth" || mcp.status === "needs_client_registration") && <button onClick={() => post({ type: "authenticate-mcp", name: mcp.name })}>OAuth 认证</button>}
          <button className="danger" onClick={() => post({ type: "delete-mcp", name: mcp.name, scope: mcp.scope })}>删除</button>
        </div>
      </details>
    </div>
  );
}

function McpForm({ workspacePath, initial, onClose }: { workspacePath?: string; initial?: McpServerView; onClose(): void }): React.JSX.Element {
  const [open, setOpen] = useState(Boolean(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState<"project" | "global">(initial?.scope ?? "project");
  const [type, setType] = useState<"local" | "remote">(initial?.type ?? "local");
  const [command, setCommand] = useState(JSON.stringify(initial?.command ?? ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."]));
  const [cwd, setCwd] = useState(initial?.cwd ?? workspacePath ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [extras, setExtras] = useState("");
  const [oauth, setOauth] = useState(initial?.oauth === "disabled" ? "false" : "");
  const [timeout, setTimeoutValue] = useState(initial?.timeout ? String(initial.timeout) : "");
  const [error, setError] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (!name.trim()) throw new Error("请输入 MCP 名称");
      const timeoutNumber = timeout ? Number(timeout) : undefined;
      if (timeoutNumber !== undefined && (!Number.isFinite(timeoutNumber) || timeoutNumber <= 0)) throw new Error("超时必须为正数");
      let input: McpInput;
      if (type === "local") {
        const commandValue = parseStringArray(command, "命令");
        const environment = parseStringRecord(extras, "环境变量");
        input = { name: name.trim(), scope, type, command: commandValue, cwd: cwd.trim() || undefined, environment, enabled: true, timeout: timeoutNumber };
      } else {
        if (!url.trim()) throw new Error("请输入远程 MCP URL");
        const headers = parseStringRecord(extras, "请求头");
        const oauthValue = oauth.trim() === "false" ? false : oauth.trim() ? parseObject(oauth, "OAuth") : undefined;
        input = { name: name.trim(), scope, type, url: url.trim(), headers, oauth: oauthValue, enabled: true, timeout: timeoutNumber };
      }
      post({ type: "save-mcp", mcp: input });
      setError("");
      setOpen(false);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (!open) return <button className="add-mcp" onClick={() => setOpen(true)}>＋ 添加 MCP Server</button>;
  return (
    <form className="mcp-form" onSubmit={submit}>
      <div className="section-title"><h4>{initial ? `编辑 ${initial.name}` : "添加 MCP"}</h4><button type="button" className="icon-button" onClick={() => { setOpen(false); onClose(); }}>×</button></div>
      <div className="segmented"><button type="button" className={type === "local" ? "active" : ""} onClick={() => setType("local")}>本地 stdio</button><button type="button" className={type === "remote" ? "active" : ""} onClick={() => setType("remote")}>远程</button></div>
      <div className="form-grid">
        <label>名称<input value={name} disabled={Boolean(initial)} onChange={(event) => setName(event.target.value)} placeholder="filesystem" /></label>
        <label>作用域<select value={scope} onChange={(event) => setScope(event.target.value as "project" | "global")}><option value="project">当前项目</option><option value="global">全局</option></select></label>
        {type === "local"
          ? <>
            <label className="wide">命令（JSON 字符串数组）<textarea value={command} onChange={(event) => setCommand(event.target.value)} /></label>
            <label className="wide">工作目录（cwd）<input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder={workspacePath || "绝对路径；留空使用当前工作区"} /><small>相对脚本路径从这里解析。保存前会检查工作目录和命令中的 .py 文件是否存在。</small></label>
          </>
          : <label className="wide">URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://server.example/mcp" /></label>}
        <label className="wide">{type === "local" ? "环境变量" : "请求头"}（JSON）<textarea value={extras} onChange={(event) => setExtras(event.target.value)} placeholder={initial ? "留空则保留现有敏感配置" : "{}"} /><small>{initial ? "出于安全原因不会把已有敏感值回传到页面；留空会原样保留。" : "对令牌等敏感值建议使用 {env:VAR} 或 {file:path}。"}</small></label>
        {type === "remote" && <label className="wide">OAuth（留空自动、false 禁用、或 JSON 配置）<textarea value={oauth} onChange={(event) => setOauth(event.target.value)} /></label>}
        <label>超时毫秒（可选）<input value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} /></label>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="settings-actions"><button type="button" onClick={() => { setOpen(false); onClose(); }}>取消</button><button className="primary" type="submit">{initial ? "保存修改" : "保存到 OpenCode"}</button></div>
    </form>
  );
}

function parseStringArray(value: string, label: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== "string")) throw new Error(`${label}必须是非空 JSON 字符串数组`);
  return parsed;
}

function parseStringRecord(value: string, label: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const parsed = parseObject(value, label);
  if (Object.values(parsed).some((item) => typeof item !== "string")) throw new Error(`${label}的值必须全部是字符串`);
  return parsed as Record<string, string>;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 对象`);
  return parsed as Record<string, unknown>;
}

function optionalPositiveNumber(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label}必须是正整数`);
  return parsed;
}
