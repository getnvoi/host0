import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, FormEvent, HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { Pause } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { cx } from "./cx";
import { Glyph } from "./glyph";

const GLYPHS = { ready: "arrow-up", blocked: Pause } as const;
const LABELS = {
  ready: "Send",
  working: "Send after the agent finishes",
  blocked: "Send after your approval",
} as const;

// A file the page already holds for the draft: `src` is an image preview.
export type ComposerFile = { name: string; src?: string };

// What is sent: the words and the files picked or pasted.
export type ComposerContent = { text: string; files: File[] };

// The file's extension in up to five letters, else "file", as Ruby's File.extname reads it.
function extension(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return (dot > 0 && base.slice(dot + 1, dot + 6)) || "file";
}

type Chosen = { file: File; url?: string };

// Ds::Composer: where you write to the agent, a floating square box, a textarea that grows, the agent it goes to,
// files as thumbnails and a round send button whose glyph carries the state. Enter sends, Shift+Enter breaks a line;
// files come from the paperclip or a paste and can be removed until sent. `onSubmit` stands for the Rails form: the
// draft clears after it, or once the promise it returns resolves.
export type ComposerProps = {
  agent?: string;
  state?: "ready" | "working" | "blocked";
  name?: string;
  value?: string;
  placeholder?: string;
  files?: ComposerFile[];
  queued?: string;
  attach?: boolean;
  disabled?: boolean;
  // Set into a surface, such as a bleed dialog: full width, no edge or shadow of its own.
  flat?: boolean;
  picker?: ReactNode;
  onSubmit?: (content: ComposerContent) => void | Promise<unknown>;
  onCancel?: () => void;
} & Omit<HTMLAttributes<HTMLFormElement>, "children" | "onSubmit">;

export function Composer({
  agent, state = "ready", name = "prompt", value, placeholder = "Ask for a change, or reply…", files = [], queued,
  attach = true, disabled = false, flat = false, picker, onSubmit, onCancel, id, className, ...rest
}: ComposerProps) {
  const fallback = useId();
  const inputId = id ? `${id}-input` : `ds-composer-${fallback.replace(/:/g, "")}`;
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(value ?? "");
  const [shown, setShown] = useState(files);
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const picking = attach && !disabled;
  const count = shown.length + chosen.length;
  const off = disabled || (!text.trim() && count === 0);

  // Without field-sizing, the textarea grows by its scroll height.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content"))) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const add = (list: File[]) =>
    setChosen((now) => [
      ...now,
      ...list.map((file) => ({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined })),
    ]);

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    add([...(event.target.files ?? [])]);
    event.target.value = "";
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const list = [...(event.clipboardData?.files ?? [])];
    if (list.length && picking) add(list);
  };

  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!off) form.current?.requestSubmit();
  };

  const clear = () => {
    setText("");
    setShown([]);
    setChosen((now) => {
      now.forEach((c) => c.url && URL.revokeObjectURL(c.url));
      return [];
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (off) return;
    const sent = onSubmit?.({ text, files: chosen.map((c) => c.file) });
    if (sent instanceof Promise) sent.then(clear, () => {});
    else clear();
  };

  const remove = (drop: () => void) => {
    drop();
    input.current?.focus();
  };

  const close = <Glyph name="close" size={12} />;

  return (
    <form
      ref={form}
      className={cx("ds-composer", `is-${state}`, className, { "is-disabled": disabled, "is-flat": flat })}
      acceptCharset="UTF-8"
      onSubmit={submit}
      id={id}
      {...rest}
    >
      {queued != null && (
        <div className="ds-composer-queued">
          <span className="ds-composer-queued-word">Queued</span>
          <span className="ds-composer-queued-text" title={queued}>{queued}</span>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      )}
      <ul className="ds-composer-files" hidden={count === 0}>
        {shown.map((file, i) => (
          <li key={`shown-${i}`} className="ds-composer-file" title={file.name}>
            <span className="ds-composer-thumb">
              {file.src ? <img src={file.src} alt="" /> : <span className="ds-composer-ext">{extension(file.name)}</span>}
            </span>
            <button
              type="button"
              className="ds-composer-remove"
              aria-label={`Remove ${file.name}`}
              onClick={() => remove(() => setShown((now) => now.filter((f) => f !== file)))}
            >
              {close}
            </button>
          </li>
        ))}
        {chosen.map((item, i) => (
          <li key={`chosen-${i}`} className="ds-composer-file" title={item.file.name}>
            <span className="ds-composer-thumb">
              <img alt="" hidden={!item.url} src={item.url} />
              <span className="ds-composer-ext">{(item.file.name.split(".").pop() || "file").slice(0, 5)}</span>
            </span>
            <button
              type="button"
              className="ds-composer-remove"
              aria-label={`Remove ${item.file.name}`}
              onClick={() =>
                remove(() => {
                  if (item.url) URL.revokeObjectURL(item.url);
                  setChosen((now) => now.filter((c) => c !== item));
                })
              }
            >
              {close}
            </button>
          </li>
        ))}
      </ul>
      <label className="ds-composer-label" htmlFor={inputId}>Message</label>
      <textarea
        ref={input}
        id={inputId}
        name={name}
        rows={2}
        placeholder={placeholder}
        disabled={disabled}
        className="ds-composer-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keydown}
        onPaste={paste}
      />
      <div className="ds-composer-foot">
        {picking && (
          <label className="ds-composer-attach" title="Attach files">
            <Glyph name="paperclip" size={16} />
            <span className="ds-composer-label">Attach files</span>
            <input type="file" name="files[]" multiple className="ds-composer-picker" onChange={picked} />
          </label>
        )}
        {picker != null ? picker : agent != null && <Badge family="blue" icon="agent">{agent}</Badge>}
        <button
          type="submit"
          className={`ds-composer-send is-${state}`}
          aria-label={LABELS[state]}
          title={LABELS[state]}
          disabled={off}
        >
          {state === "working" ? <span className="ds-composer-spin" aria-hidden="true" /> : <Glyph name={GLYPHS[state]} size={16} />}
        </button>
      </div>
    </form>
  );
}
