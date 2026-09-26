import { useEffect, useMemo, useState } from "react";
import type { FormEvent, HTMLAttributes, ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";

const SENTENCES = {
  preparing: "Setting up the box…",
  working: "The agent is working…",
  waiting: "The agent is waiting on you…",
  reconnecting: "Reconnecting…",
} as const;

// What the Rails page asks before it stops a run, for a caller that confirms in `onStop`.
export const STOP_CONFIRM = {
  title: "Stop this run?",
  text: "The agent stops where it is. What it changed stays.",
  verb: "Stop run",
  cancel: "Keep running",
  danger: true,
} as const;

function elapsed(started: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${pad(Math.floor((seconds % 3600) / 60))}m`;
}

// Ds::Working: the working line under a session's last turn, a busy dot, the sentence, the time it has taken, and
// Stop run while the agent works. `reconnecting` is the same line while the live stream is down: it shows only once
// `connected` has been true and turns false, and hides the working line after it.
export type WorkingProps = {
  kind?: keyof typeof SENTENCES;
  since?: Date | number;
  onStop?: () => void;
  text?: ReactNode;
  still?: boolean;
  connected?: boolean;
  action?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Working({
  kind = "working", since, onStop, text, still = false, connected, action, className, ...rest
}: WorkingProps) {
  const key = since instanceof Date ? since.getTime() : since;
  const started = useMemo(
    () => (since == null ? null : since instanceof Date ? since.getTime() : Date.now() - since * 1000),
    [key],
  );
  const [, setTick] = useState(0);
  const [seen, setSeen] = useState(false);
  const reconnecting = kind === "reconnecting";
  const watching = reconnecting && !still;

  useEffect(() => {
    if (started == null || reconnecting) return;
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(clock);
  }, [started, reconnecting]);

  useEffect(() => {
    if (connected) setSeen(true);
  }, [connected]);

  const hidden = watching ? connected !== false || !seen : undefined;
  const stop = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStop?.();
  };

  return (
    <div className={cx("ds-working", `is-${kind}`, className)} hidden={hidden} {...rest}>
      <span className="ds-working-line" role="status" aria-live="polite">
        <span className="ds-working-dot" aria-hidden="true" />
        <span className="ds-working-text">{text ?? SENTENCES[kind]}</span>
      </span>
      {started != null && !reconnecting && (
        <time className="ds-working-time" dateTime={new Date(started).toISOString()}>{elapsed(started)}</time>
      )}
      {action != null && <span className="ds-working-action">{action}</span>}
      {onStop && kind === "working" && (
        <form className="ds-working-stop" onSubmit={stop}>
          <Button variant="ghost" size="sm" type="submit" glyph="close">Stop run</Button>
        </form>
      )}
    </div>
  );
}
