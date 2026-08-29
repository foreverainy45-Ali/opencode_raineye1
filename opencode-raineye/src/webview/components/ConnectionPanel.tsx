import { useEffect, useState } from "react";
import type { ConnectionState, SettingsView } from "../../shared/protocol";
import { post } from "../vscode";

export function ConnectionPanel({ connection, settings }: { connection: ConnectionState; settings: SettingsView }): React.JSX.Element {
  const [host, setHost] = useState(settings.serverUrl || "127.0.0.1");
  const [port, setPort] = useState(settings.serverPort);
  const [password, setPassword] = useState("");
  const pending = ["discovering", "starting", "connecting"].includes(connection.phase);

  useEffect(() => {
    if (settings.serverUrl) setHost(settings.serverUrl);
    setPort(settings.serverPort);
  }, [settings]);

  useEffect(() => {
    if (connection.phase !== "auth-required" || !connection.endpoint) return;
    try {
      const endpoint = new URL(connection.endpoint);
      setHost(`${endpoint.protocol}//${endpoint.hostname}`);
      if (endpoint.port) setPort(Number(endpoint.port));
    } catch {
      setHost(connection.endpoint);
    }
  }, [connection.endpoint, connection.phase]);

  return (
    <main className="empty-stage connection-stage">
      <div className={`connection-orb ${pending ? "pulse" : ""}`}><span>◉</span></div>
      <h2>{pending ? connection.message : "连接 OpenCode"}</h2>
      <p className="muted">RainEye 直接连接官方 OpenCode Server，会话、Skill、MCP 与终端客户端共享。</p>
      {connection.message && !pending && <div className={`notice ${connection.phase === "error" ? "error" : ""}`}>{connection.message}</div>}
      <div className="connection-actions">
        <button className="primary" disabled={pending} onClick={() => post({ type: "reconnect" })}>自动发现</button>
        <button disabled={pending} onClick={() => post({ type: "start-server" })}>新建本机进程</button>
      </div>
      <details className="manual-connect" open={connection.phase === "error" || connection.phase === "disconnected" || connection.phase === "auth-required"}>
        <summary>手动连接</summary>
        <label>主机或 URL<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="127.0.0.1 或 https://host" /></label>
        <label>端口<input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} /></label>
        <label>密码（可选）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button disabled={pending || !host.trim()} onClick={() => post({ type: "connect-manual", host, port, password: password || undefined })}>连接</button>
      </details>
    </main>
  );
}
