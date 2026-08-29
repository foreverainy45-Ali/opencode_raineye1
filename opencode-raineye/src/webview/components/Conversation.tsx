import { useEffect, useRef, useState } from "react";
import type { DiffView, PermissionView, QuestionView, UiMessage, UiMessagePart } from "../../shared/protocol";
import { post } from "../vscode";
import { Markdown } from "./Markdown";

export function Conversation({
  messages,
  busy,
  permissions,
  questions,
  diffs,
}: {
  messages: UiMessage[];
  busy: boolean;
  permissions: PermissionView[];
  questions: QuestionView[];
  diffs: DiffView[];
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages, permissions, questions]);

  if (!messages.length && !permissions.length && !questions.length) {
    return (
      <div className="welcome">
        <div className="rain-mark">R</div>
        <h2>我能为你做什么？</h2>
        <p>引用代码、选择模型与 Skill，然后描述你要完成的任务。</p>
        <div className="suggestions">
          <span>解释当前项目结构</span><span>定位并修复错误</span><span>规划新功能</span>
        </div>
      </div>
    );
  }

  return (
    <div className="conversation-scroll">
      <div className="conversation">
        {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {busy && <div className="thinking"><i /><i /><i /><span>OpenCode 正在工作</span></div>}
        {permissions.map((permission) => <PermissionCard key={permission.id} permission={permission} />)}
        {questions.map((question) => <QuestionCard key={question.id} request={question} />)}
        {!busy && diffs.length > 0 && <DiffSummary diffs={diffs} />}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: UiMessage }): React.JSX.Element {
  const visible = message.parts.filter((part) => !(part.kind === "status" && part.text === "开始执行"));
  return (
    <article className={`message ${message.role}`}>
      <div className="message-meta">
        <span>{message.role === "user" ? "你" : "RainEye"}</span>
        {message.agent && <small>{message.agent}</small>}
        <time>{formatTime(message.createdAt)}</time>
      </div>
      <div className="message-body">
        {visible.map((part) => <PartView key={part.id} part={part} role={message.role} />)}
        {message.error && <div className="part-error">{message.error}</div>}
      </div>
    </article>
  );
}

function PartView({ part, role }: { part: UiMessagePart; role: UiMessage["role"] }): React.JSX.Element | null {
  if (part.kind === "text") {
    return role === "assistant" ? <Markdown text={part.text ?? ""} /> : <div className="user-text">{part.text}</div>;
  }
  if (part.kind === "reasoning") {
    return <details className="reasoning"><summary>思考过程</summary><Markdown text={part.text ?? ""} /></details>;
  }
  if (part.kind === "tool" && part.tool) {
    const tool = part.tool;
    return (
      <details className={`tool-call status-${tool.status}`} open={tool.status === "error"}>
        <summary><span className="tool-dot" />{tool.title || tool.tool}<em>{tool.status}</em></summary>
        {tool.input !== undefined && <pre>{stringify(tool.input)}</pre>}
        {tool.output && <pre>{tool.output}</pre>}
        {tool.error && <div className="part-error">{tool.error}</div>}
      </details>
    );
  }
  if (part.kind === "file") {
    if (part.mime?.startsWith("image/") && part.url) return <img className="message-image" src={part.url} alt={part.filename || "附件"} />;
    return <div className="file-part">▤ {part.filename || "文件附件"}</div>;
  }
  if (part.kind === "patch") return <div className="patch-part">修改文件<br />{part.text}</div>;
  if (part.kind === "error") return <div className="part-error">{part.text}</div>;
  if (part.kind === "status") return <div className="part-status">{part.text}</div>;
  return null;
}

function PermissionCard({ permission }: { permission: PermissionView }): React.JSX.Element {
  return (
    <section className="approval-card">
      <div className="approval-icon">!</div>
      <div className="approval-content">
        <strong>执行前审批</strong>
        <p>OpenCode 请求 <code>{permission.permission}</code> 权限</p>
        {permission.patterns.length > 0 && <pre>{permission.patterns.join("\n")}</pre>}
        <div className="approval-actions">
          <button className="primary" onClick={() => post({ type: "reply-permission", requestId: permission.id, reply: "once" })}>允许一次</button>
          <button onClick={() => post({ type: "reply-permission", requestId: permission.id, reply: "always" })}>本次会话允许</button>
          <button className="danger" onClick={() => post({ type: "reply-permission", requestId: permission.id, reply: "reject" })}>拒绝</button>
        </div>
      </div>
    </section>
  );
}

function QuestionCard({ request }: { request: QuestionView }): React.JSX.Element {
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []));
  const toggle = (questionIndex: number, label: string, multiple?: boolean) => {
    setAnswers((current) => current.map((answer, index) => {
      if (index !== questionIndex) return answer;
      if (!multiple) return [label];
      return answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label];
    }));
  };
  const complete = request.questions.every((_, index) => answers[index]?.length);
  return (
    <section className="question-card">
      {request.questions.map((question, questionIndex) => (
        <div key={`${request.id}-${questionIndex}`}>
          <small>{question.header}</small><strong>{question.question}</strong>
          <div className="question-options">
            {question.options.map((option) => (
              <button
                key={option.label}
                className={answers[questionIndex]?.includes(option.label) ? "selected" : ""}
                onClick={() => toggle(questionIndex, option.label, question.multiple)}
              >
                {option.label}{option.description && <span>{option.description}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="approval-actions">
        <button className="primary" disabled={!complete} onClick={() => post({ type: "reply-question", requestId: request.id, answers })}>提交</button>
        <button onClick={() => post({ type: "reject-question", requestId: request.id })}>取消</button>
      </div>
    </section>
  );
}

function DiffSummary({ diffs }: { diffs: DiffView[] }): React.JSX.Element {
  const additions = diffs.reduce((sum, diff) => sum + (diff.additions ?? 0), 0);
  const deletions = diffs.reduce((sum, diff) => sum + (diff.deletions ?? 0), 0);
  return (
    <details className="diff-summary">
      <summary><strong>执行后 Diff</strong><span>{diffs.length} 个文件</span><em>+{additions} / -{deletions}</em></summary>
      <div className="diff-files">
        {diffs.map((diff) => (
          <details key={diff.file}>
            <summary>
              <button className="link-button" onClick={(event) => { event.preventDefault(); post({ type: "show-diff", file: diff.file }); }}>{diff.file}</button>
              <span className="add">+{diff.additions ?? 0}</span><span className="del">-{diff.deletions ?? 0}</span>
            </summary>
            {diff.patch && <pre>{diff.patch}</pre>}
          </details>
        ))}
      </div>
    </details>
  );
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
