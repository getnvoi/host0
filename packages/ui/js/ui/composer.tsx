import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Pause } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";

// working and blocked still take a message: the plane queues it. Only broken locks.
export type ComposerState = "ready" | "working" | "blocked" | "broken";

const DRAFTS = "nvoi.drafts";

function readDraft(key?: string): string {
  if (!key) return "";
  try {
    return (JSON.parse(localStorage.getItem(DRAFTS) ?? "{}") as Record<string, string>)[key] ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string | undefined, value: string) {
  if (!key) return;
  try {
    const all = JSON.parse(localStorage.getItem(DRAFTS) ?? "{}") as Record<string, string>;
    if (value) all[key] = value;
    else delete all[key];
    localStorage.setItem(DRAFTS, JSON.stringify(all));
  } catch {
    // Storage refused: the draft lives as long as the page.
  }
}

export function Composer({
  onSend,
  state = "ready",
  draft,
  autoFocus,
  placeholder,
  tall,
  start,
}: {
  // false means refused: the text goes back in the box, if the box is still empty.
  onSend: (content: string) => void | boolean | Promise<void | boolean>;
  state?: ComposerState;
  draft?: string;
  autoFocus?: boolean;
  placeholder?: string;
  tall?: boolean;
  start?: ReactNode;
}) {
  const { t } = useTranslations();
  const [value, setValue] = useState(() => readDraft(draft));
  const ready = state !== "broken";
  const box = useRef<HTMLTextAreaElement>(null);
  // A box that starts disabled (nothing to send into yet) takes focus once it can.
  useEffect(() => {
    if (autoFocus && ready) box.current?.focus();
  }, [autoFocus, ready]);
  const label = t(state === "ready" ? "composer.send" : state === "broken" ? "composer.broken" : "composer.queue");

  function change(next: string) {
    setValue(next);
    writeDraft(draft, next);
  }

  async function submit() {
    const content = value.trim();
    if (!content || !ready) return;
    change("");
    if ((await onSend(content)) === false) {
      setValue((current) => {
        if (current !== "") return current;
        writeDraft(draft, content);
        return content;
      });
    }
  }

  return (
    <div className={`composer${tall ? " tall" : ""}`}>
      <textarea
        ref={box}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        aria-label={placeholder ?? t("composer.write")}
        placeholder={placeholder ?? t("composer.write")}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={!ready}
      />
      <div className="composer-foot">
        {start}
        <button type="button" className="send" onClick={submit} disabled={!ready || !value.trim()} aria-label={label} title={label}>
          {state === "working" && value.trim() === "" ? <span className="spin" /> : state === "blocked" && value.trim() === "" ? <Pause /> : <ArrowUp />}
        </button>
      </div>
    </div>
  );
}
