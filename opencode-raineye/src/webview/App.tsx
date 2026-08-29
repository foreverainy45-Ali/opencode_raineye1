import { useEffect, useState } from "react";
import type { AttachmentView, FileSuggestion, HostToWebviewMessage, UiSnapshot, ViewSection } from "../shared/protocol";
import { Composer } from "./components/Composer";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { Conversation } from "./components/Conversation";
import { History } from "./components/History";
import { Settings } from "./components/Settings";
import { post, vscode } from "./vscode";

interface Toast { id: number; level: "info" | "warning" | "error"; message: string }

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<UiSnapshot>();
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [focusToken, setFocusToken] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fileSuggestions, setFileSuggestions] = useState<{ requestId: number; query: string; files: FileSuggestion[] }>({ requestId: 0, query: "", files: [] });

  useEffect(() => {
    const listener = (event: MessageEvent<HostToWebviewMessage>) => {
      const message = event.data;
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
        vscode.setState({ snapshot: message.snapshot });
      }
      if (message.type === "insert-reference") {
        setAttachments((current) => current.some((item) => item.id === message.attachment.id) ? current : [...current, message.attachment]);
        setFocusToken((value) => value + 1);
      }
      if (message.type === "focus-composer") setFocusToken((value) => value + 1);
      if (message.type === "file-suggestions") {
        setFileSuggestions((current) => message.requestId >= current.requestId ? message : current);
      }
      if (message.type === "toast") {
        const id = Date.now();
        setToasts((current) => [...current, { id, level: message.level, message: message.message }]);
        window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4_000);
      }
    };
    window.addEventListener("message", listener);
    post({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  if (!snapshot) return <div className="boot"><div className="spinner" /><span>正在载入 RainEye…</span></div>;

  const connected = snapshot.connection.phase === "connected";
  const currentSession = snapshot.sessions.find((session) => session.id === snapshot.currentSessionId);
  const navigate = (section: ViewSection) => post({ type: "navigate", section });

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" title="OpenCode RainEye" onClick={() => navigate("chat")}><span>R</span><b>RainEye</b></button>
        <nav>
          <button className={snapshot.section === "chat" ? "active" : ""} onClick={() => navigate("chat")} title="对话">⌁</button>
          <button onClick={() => post({ type: "new-session" })} title="新增对话">＋</button>
          <button className={snapshot.section === "history" ? "active" : ""} onClick={() => navigate("history")} title="历史对话">◷</button>
          <button className={snapshot.section === "settings" ? "active" : ""} onClick={() => navigate("settings")} title="设置">⚙</button>
        </nav>
      </header>

      {!connected
        ? <ConnectionPanel connection={snapshot.connection} settings={snapshot.settings} />
        : snapshot.section === "history"
          ? <History sessions={snapshot.sessions} currentSessionId={snapshot.currentSessionId} />
          : snapshot.section === "settings"
            ? <Settings settings={snapshot.settings} connection={snapshot.connection} mcps={snapshot.mcps} skills={snapshot.skills} models={snapshot.models} />
            : (
              <main className="chat-page">
                <div className="chat-heading">
                  <div><strong>{currentSession?.title || "新增对话"}</strong><span>{snapshot.workspaceName}</span></div>
                  <button className="server-badge" title={`${snapshot.connection.endpoint}\n点击重连`} onClick={() => post({ type: "reconnect" })}><i />{snapshot.connection.version}</button>
                </div>
                {snapshot.error && <div className="inline-error">{snapshot.error}<button onClick={() => post({ type: "refresh" })}>重试</button></div>}
                <Conversation messages={snapshot.messages} busy={snapshot.busy} permissions={snapshot.permissions} questions={snapshot.questions} diffs={snapshot.diffs} />
                <Composer
                  mode={snapshot.mode}
                  selectedModel={snapshot.selectedModel}
                  selectedSkill={snapshot.selectedSkill}
                  models={snapshot.models}
                  skills={snapshot.skills}
                  attachments={attachments}
                  busy={snapshot.busy}
                  focusToken={focusToken}
                  fileSuggestions={fileSuggestions}
                  onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                  onSent={() => setAttachments([])}
                />
              </main>
            )}

      <div className="toast-stack">
        {toasts.map((toast) => <div key={toast.id} className={`toast ${toast.level}`}>{toast.message}</div>)}
      </div>
    </div>
  );
}
