import { useEffect, useRef, useState } from "react";
import type { AttachmentView, ChatMode, ModelOption, SkillOption } from "../../shared/protocol";
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
  onRemoveAttachment,
  onSent,
}: {
  mode: ChatMode;
  selectedModel?: string;
  selectedSkill?: string;
  models: ModelOption[];
  skills: SkillOption[];
  attachments: AttachmentView[];
  busy: boolean;
  focusToken: number;
  onRemoveAttachment(id: string): void;
  onSent(): void;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [model, setModel] = useState(selectedModel ?? "");
  const [skill, setSkill] = useState(selectedSkill ?? "");
  const [height, setHeight] = useState(190);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setModel(selectedModel ?? ""), [selectedModel]);
  useEffect(() => setSkill(selectedSkill ?? ""), [selectedSkill]);
  useEffect(() => textareaRef.current?.focus(), [focusToken]);

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
      skill: skill || undefined,
      attachments,
    });
    setText("");
    onSent();
  };

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
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
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
            <select value={skill} onChange={(event) => setSkill(event.target.value)} title="Skill">
              <option value="">Skill: 自动</option>
              {skills.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </div>
          {busy
            ? <button className="send-button stop" title="停止" onClick={() => post({ type: "abort" })}>■</button>
            : <button className="send-button" title="发送" disabled={!text.trim() && !attachments.length} onClick={send}>↑</button>}
        </div>
      </div>
    </div>
  );
}
