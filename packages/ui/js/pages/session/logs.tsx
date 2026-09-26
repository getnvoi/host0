import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { readLog, useLogSources } from "@/contexts/api/sessions";
import { watchAway } from "@/lib/away";
import { Sheet } from "@/ui/dialog";

// Terminal colour and cursor codes, which a log shown as text drops.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// The sandbox's setup and service output, followed every two seconds while shown and the page is in view.
export function Logs({ session, subtitle, name, onPick, onClose }: { session: string; subtitle: string; name: string; onPick: (name: string) => void; onClose: () => void }) {
  const { t } = useTranslations();
  const sources = useLogSources(session, true);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let offset = 0;
    let live = true;
    // Hidden for a minute: polling rests until the page shows again, from the same offset.
    let paused = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout>;
    setText("");
    setError(undefined);
    const poll = async () => {
      reading = true;
      try {
        const { text: raw, next } = await readLog(session, name, offset);
        const more = raw.replace(ANSI, "");
        if (!live) return;
        offset = next;
        if (more) {
          const el = body.current;
          const bottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setText((x) => (x + more).slice(-2_000_000));
          if (bottom) requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight));
        }
        setError(undefined);
      } catch (e) {
        if (live) setError(messageFrom(e, t));
      } finally {
        reading = false;
      }
      if (live && !paused) timer = setTimeout(poll, 2000);
    };
    poll();
    const stop = watchAway(60_000, {
      away: () => {
        paused = true;
        clearTimeout(timer);
      },
      back: () => {
        paused = false;
        if (!reading) poll();
      },
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stop();
    };
  }, [session, name, t]);

  return (
    <Sheet
      label={t("logs.title")}
      onClose={onClose}
      head={
        <div className="sheet-head">
          <div className="sheet-heading">
            <span className="sheet-title">{t("logs.title")}</span>
            <span className="sheet-text">{subtitle}</span>
          </div>
          {sources.data && sources.data.length > 1 && (
            <nav className="seg sm" aria-label={t("logs.sources")}>
              {sources.data.map((s) => (
                <button key={s.name} type="button" aria-pressed={s.name === name} onClick={() => onPick(s.name)}>
                  {s.kind === "setup" ? t("logs.setup") : s.name}
                </button>
              ))}
            </nav>
          )}
          <button type="button" className="btn ghost sm icon" aria-label={t("common.close")} onClick={onClose}>
            <X />
          </button>
        </div>
      }
    >
      <div className="sheet-body" ref={body}>
        {error && <p className="log-empty">{error}</p>}
        {!error && !text && <p className="log-empty">{t("logs.empty")}</p>}
        {text && <pre className="log">{text}</pre>}
      </div>
    </Sheet>
  );
}
