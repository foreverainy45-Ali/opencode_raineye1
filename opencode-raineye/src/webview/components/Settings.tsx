import { FormEvent, useEffect, useState } from "react";
import type { ConnectionState, McpInput, McpServerView, SettingsView, SkillOption } from "../../shared/protocol";
import { post } from "../vscode";

export function Settings({
  settings: initial,
  connection,
  mcps,
  skills,
}: {
  settings: SettingsView;
  connection: ConnectionState;
  mcps: McpServerView[];
  skills: SkillOption[];
}): React.JSX.Element {
  const [settings, setSettings] = useState(initial);
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
        <div className="section-title"><div><h3>MCP</h3><p>配置直接写入 OpenCode；远程连接由官方运行时自动尝试 HTTP 与 SSE。</p></div><span className="count">{mcps.length}</span></div>
        <div className="mcp-list">
          {mcps.map((mcp) => <McpRow key={`${mcp.scope}-${mcp.name}`} mcp={mcp} />)}
          {!mcps.length && <div className="empty-list">尚未配置 MCP Server</div>}
        </div>
        <McpForm />
      </section>

      <section className="settings-card">
        <div className="section-title"><div><h3>Skills</h3><p>由 OpenCode 原生扫描与加载，RainEye 不读取或注入 Skill 正文。</p></div><span className="count">{skills.length}</span></div>
        <div className="skill-list">
          {skills.slice(0, 30).map((skill) => <div key={skill.name}><strong>{skill.name}</strong><span>{skill.description}</span><code>{skill.location}</code></div>)}
          {!skills.length && <div className="empty-list">未发现 Skill。可在 .opencode/skills、.agents/skills 等官方目录添加。</div>}
        </div>
      </section>
    </main>
  );
}

function StatusPill({ connection }: { connection: ConnectionState }): React.JSX.Element {
  return <span className={`status-pill ${connection.phase}`}><i />{connection.phase === "connected" ? connection.message : connection.phase}</span>;
}

function McpRow({ mcp }: { mcp: McpServerView }): React.JSX.Element {
  return (
    <div className="mcp-row">
      <div className={`mcp-status ${mcp.status}`} />
      <div className="mcp-info"><strong>{mcp.name}</strong><span>{mcp.type === "local" ? mcp.command?.join(" ") || "本地命令" : mcp.url}</span><small>{mcp.scope === "global" ? "全局" : "项目"} · {mcp.status}{mcp.detail ? ` · ${mcp.detail}` : ""}</small></div>
      <div className="mcp-actions">
        {(mcp.status === "needs_auth" || mcp.status === "needs_client_registration") && <button onClick={() => post({ type: "authenticate-mcp", name: mcp.name })}>认证</button>}
        {mcp.status === "connected"
          ? <button onClick={() => post({ type: "disconnect-mcp", name: mcp.name })}>断开</button>
          : <button onClick={() => post({ type: "connect-mcp", name: mcp.name })}>连接</button>}
      </div>
    </div>
  );
}

function McpForm(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"project" | "global">("project");
  const [type, setType] = useState<"local" | "remote">("local");
  const [command, setCommand] = useState('["npx", "-y", "@modelcontextprotocol/server-filesystem", "."]');
  const [url, setUrl] = useState("");
  const [extras, setExtras] = useState("{}");
  const [oauth, setOauth] = useState("");
  const [timeout, setTimeoutValue] = useState("");
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
        input = { name: name.trim(), scope, type, command: commandValue, environment, enabled: true, timeout: timeoutNumber };
      } else {
        if (!url.trim()) throw new Error("请输入远程 MCP URL");
        const headers = parseStringRecord(extras, "请求头");
        const oauthValue = oauth.trim() === "false" ? false : oauth.trim() ? parseObject(oauth, "OAuth") : undefined;
        input = { name: name.trim(), scope, type, url: url.trim(), headers, oauth: oauthValue, enabled: true, timeout: timeoutNumber };
      }
      post({ type: "save-mcp", mcp: input });
      setError("");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (!open) return <button className="add-mcp" onClick={() => setOpen(true)}>＋ 添加 MCP Server</button>;
  return (
    <form className="mcp-form" onSubmit={submit}>
      <div className="section-title"><h4>添加或更新 MCP</h4><button type="button" className="icon-button" onClick={() => setOpen(false)}>×</button></div>
      <div className="segmented"><button type="button" className={type === "local" ? "active" : ""} onClick={() => setType("local")}>本地 stdio</button><button type="button" className={type === "remote" ? "active" : ""} onClick={() => setType("remote")}>远程</button></div>
      <div className="form-grid">
        <label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="filesystem" /></label>
        <label>作用域<select value={scope} onChange={(event) => setScope(event.target.value as "project" | "global")}><option value="project">当前项目</option><option value="global">全局</option></select></label>
        {type === "local"
          ? <label className="wide">命令（JSON 字符串数组）<textarea value={command} onChange={(event) => setCommand(event.target.value)} /></label>
          : <label className="wide">URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://server.example/mcp" /></label>}
        <label className="wide">{type === "local" ? "环境变量" : "请求头"}（JSON，对敏感值谨慎保存）<textarea value={extras} onChange={(event) => setExtras(event.target.value)} /></label>
        {type === "remote" && <label className="wide">OAuth（留空自动、false 禁用、或 JSON 配置）<textarea value={oauth} onChange={(event) => setOauth(event.target.value)} /></label>}
        <label>超时毫秒（可选）<input value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} /></label>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="settings-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button className="primary" type="submit">保存到 OpenCode</button></div>
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
