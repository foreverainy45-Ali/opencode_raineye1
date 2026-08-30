import { useMemo, useState } from "react";
import type { SessionSummary } from "../../shared/protocol";
import { post } from "../vscode";

export function History({ sessions, currentSessionId }: { sessions: SessionSummary[]; currentSessionId?: string }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const retained = useMemo(() => sessions.filter((session) => session.hasMessages !== false), [sessions]);
  const filtered = useMemo(() => retained.filter((session) => session.title.toLowerCase().includes(query.toLowerCase())), [retained, query]);
  return (
    <main className="page history-page">
      <div className="page-heading"><div><h2>历史对话</h2><p>{retained.length} 个有消息的 OpenCode 会话</p></div><button className="primary" onClick={() => post({ type: "new-session" })}>＋ 新增对话</button></div>
      <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话" />
      <div className="session-list">
        {filtered.map((session) => (
          <div key={session.id} className={`session-row ${session.id === currentSessionId ? "active" : ""}`}>
            <button className="session-main" onClick={() => post({ type: "open-session", sessionId: session.id })}>
              <strong>{session.title}</strong>
              <span>{relativeDate(session.updatedAt)}</span>
              {(session.files ?? 0) > 0 && <small>{session.files} 文件 · <i>+{session.additions ?? 0}</i> / <em>-{session.deletions ?? 0}</em></small>}
            </button>
            <button className="icon-button danger" title="删除" onClick={() => post({ type: "delete-session", sessionId: session.id })}>×</button>
          </div>
        ))}
        {!filtered.length && <div className="empty-list">没有匹配的对话</div>}
      </div>
    </main>
  );
}

function relativeDate(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString();
}
