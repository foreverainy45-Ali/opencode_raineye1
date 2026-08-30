import { useEffect, useRef, useState } from "react";
import type { AttachmentView, ChatMode, FileSuggestion, ModelOption, SkillOption } from "../../shared/protocol";
import { post } from "../vscode";

export function Composer({
  mode: initialMode,
  selectedModel,
  selectedSkill,
  models,
  skills,
  attachments,
  busy,
  focusToken,
  fileSuggestions,
  onRemoveAttachment,
  onSent,
}: {
  mode: ChatMode;
  selectedModel?: string;
  selectedSkill?: string[];
  models: ModelOption[];
  skills: SkillOption[];
  attachments: AttachmentView[];
  busy: boolean;
  focusToken: number;
  fileSuggestions: { requestId: number; query: string; files: FileSuggestion[] };
  onRemoveAttachment(id: string): void;
  onSent(): void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [model, setModel] = useState(selectedModel ?? "");
  const [selectedSkills, setSelectedSkills] = useState<string[]>(selectedSkill ?? []);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [height, setHeight] = useState(190);
  const [mention, setMention] = useState<{ start: number; end: number; query: string }>();
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionRequest = useRef(0);
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setModel(selectedModel ?? ""), [selectedModel]);
  useEffect(() => setSelectedSkills(selectedSkill ?? []), [selectedSkill]);
  useEffect(() => textareaRef.current?.focus(), [focusToken]);

  useEffect(() => {
    const clearInline = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".mention-suggestions") && target !== textareaRef.current) setMention(undefined);
      if (!target.closest(".skills-picker")) setSkillsOpen(false);
    };
    document.addEventListener("pointerdown", clearInline);
    return () => document.removeEventListener("pointerdown", clearInline);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!drag.current) return;
      setHeight(Math.max(132, Math.min(430, drag.current.height + drag.current.y - event.clientY)));
    };
    const up = () => { drag.current = undefined; document.body.classList.remove("resizing-composer"); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const send = () => {
    if (busy || (!text.trim() && !attachments.length)) return;
    post({
      type: "send",
      text,
      mode,
      model: model || undefined,
      skills: selectedSkills.length ? selectedSkills : undefined,
      attachments,
    });
    setText("");
    setMention(undefined);
    onSent();
  };

  const updateMention = (value: string, cursor: number) => {
    const next = findMention(value, cursor);
    setMention(next);
    setSuggestionIndex(0);
    if (next) {
      const requestId = ++suggestionRequest.current;
      post({ type: "search-files", requestId, query: next.query });
    }
  };

  const applySuggestion = (file: FileSuggestion) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.end);
    const reference = `@${file.path}`;
    const separator = after && !/^\s/.test(after) ? " " : "";
    const next = `${before}${reference}${separator}${after}`;
    const cursor = before.length + reference.length + separator.length;
    setText(next);
    setMention(undefined);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const visibleSuggestions = mention && fileSuggestions.query === mention.query ? fileSuggestions.files : [];

  return (
    <div className="composer-wrap" style={{ height }}>
      <button
        className="composer-resize"
        title="上下拖动调整输入框高度"
        onPointerDown={(event) => {
          drag.current = { y: event.clientY, height };
          document.body.classList.add("resizing-composer");
        }}
      ><span /></button>
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <div className={`attachment-chip ${attachment.kind}`} key={attachment.id} title={attachment.reference || attachment.path}>
                {attachment.kind === "image" && attachment.dataUrl
                  ? <img src={attachment.dataUrl} alt="" />
                  : <span className="at-symbol">@</span>}
                <span>{attachment.name}</span>
                <button title="移除" onClick={() => onRemoveAttachment(attachment.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        {mention && visibleSuggestions.length > 0 && (
          <div className="mention-suggestions" role="listbox" aria-label="工作区文件">
            {visibleSuggestions.map((file, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === suggestionIndex}
                className={index === suggestionIndex ? "active" : ""}
                key={file.path}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(file);
                }}
              ><strong>{file.name}</strong><span>{file.path}</span></button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onBlur={() => setMention(undefined)}
          onChange={(event) => {
            setText(event.target.value);
            updateMention(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
            }
          }}
          onKeyDown={(event) => {
            if (mention && visibleSuggestions.length) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSuggestionIndex((value) => (value + 1) % visibleSuggestions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSuggestionIndex((value) => (value - 1 + visibleSuggestions.length) % visibleSuggestions.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const selected = visibleSuggestions[suggestionIndex];
                if (selected) applySuggestion(selected);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(undefined);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={mode === "plan" ? "描述目标，让 OpenCode 先制定计划…" : "给 OpenCode 发消息…"}
        />
        <div className="composer-tools">
          <div className="attachment-actions">
            <button title="引用工作区文件" onClick={() => post({ type: "select-file" })}><b>@</b></button>
            <button title="添加图片" onClick={() => post({ type: "select-image" })}>▧</button>
          </div>
          <div className="composer-selectors">
            <select value={mode} onChange={(event) => setMode(event.target.value as ChatMode)} title="工作模式">
              <option value="craft">Craft</option>
              <option value="plan">Plan</option>
            </select>
            <select value={model} onChange={(event) => setModel(event.target.value)} title="模型">
              {!models.length && <option value="">无可用模型</option>}
              {models.map((item) => <option key={item.id} value={item.id}>{item.providerName} · {item.name}</option>)}
            </select>
            <div className="skills-picker">
              <button type="button" className={`skills-trigger${selectedSkills.length ? " selected" : ""}`} title="选择 Skill" onClick={() => setSkillsOpen((open) => !open)}>Skills</button>
              {skillsOpen && <div className="skills-popover" role="menu">
              {!skills.length && <span className="skills-empty">暂无可用 Skill</span>}
                {skills.map((item) => {
                  const checked = selectedSkills.includes(item.name);
                  return <button type="button" role="menuitemcheckbox" aria-checked={checked} className={`skill-option${checked ? " checked" : ""}`} key={item.name} onClick={() => setSelectedSkills((current) => checked ? current.filter((name) => name !== item.name) : [...current, item.name])}>
                    <span className="skill-check">{checked ? "✓" : ""}</span><span>{item.name}</span>
                  </button>;
                })}
              </div>}
            </div>
          </div>
          {busy
            ? <button className="send-button stop" title="停止" onClick={() => post({ type: "abort" })}>■</button>
            : <button className="send-button" title="发送" disabled={!text.trim() && !attachments.length} onClick={send}>↑</button>}
        </div>
      </div>
    </div>
  );
}

function findMention(value: string, cursor: number): { start: number; end: number; query: string } | undefined {
  const prefix = value.slice(0, cursor);
  const start = prefix.lastIndexOf("@");
  if (start < 0) return undefined;
  const query = prefix.slice(start + 1);
  if (/\s/.test(query)) return undefined;
  const preceding = start > 0 ? prefix[start - 1] : undefined;
  if (preceding && /[a-zA-Z0-9._%+-]/.test(preceding)) return undefined;
  return { start, end: cursor, query };
}
