import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

// Ds::Log: what a machine printed, line after line, in mono: a box's log, the terminal of a session. It keeps to the
// newest line while the reader is at the bottom; scrolled up, it stays put. Each child span is one line.
export type LogProps = {
  lines?: ReactNode[];
  // Shown while there are no lines.
  empty?: ReactNode;
  // A fixed height in px; without it the log fills the room a flex column leaves it, and is 320 tall elsewhere.
  height?: number;
  edge?: boolean;
} & HTMLAttributes<HTMLPreElement>;

export function Log({ lines = [], empty, height, edge = true, className, style, ...rest }: LogProps) {
  const ref = useRef<HTMLPreElement>(null);

  // Follows the newest line while the reader is at the bottom; a reader who scrolled up keeps their place.
  useEffect(() => {
    const log = ref.current;
    if (!log) return;
    let pinned = true;
    log.scrollTop = log.scrollHeight;
    const onScroll = () => {
      pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
    };
    log.addEventListener("scroll", onScroll, { passive: true });
    const observer = new MutationObserver(() => {
      if (pinned) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log, { childList: true });
    return () => {
      observer.disconnect();
      log.removeEventListener("scroll", onScroll);
    };
  }, []);

  const css = height ? ({ "--height": `${height}px`, ...style } as CSSProperties) : style;
  return (
    <pre ref={ref} className={cx("ds-log", className, { "has-height": height, "is-bare": !edge })} style={css} tabIndex={0} {...rest}>
      {lines.length === 0 && empty ? (
        <>
          <span className="ds-log-empty">{empty}</span>
          {"\n"}
        </>
      ) : (
        lines.map((line, i) => (
          <span key={i}>
            {line}
            {"\n"}
          </span>
        ))
      )}
    </pre>
  );
}
