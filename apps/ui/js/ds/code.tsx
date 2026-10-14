import { useEffect, useRef, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";

const SHELLS = ["sh", "shell", "bash", "zsh", "console"];

// Ds::Code: a block of code, a frame, a copy button; `source` is the code as text, children are kept as given.
export type CodeProps = {
  source?: string;
  lang?: string;
  title?: ReactNode;
  frame?: "terminal" | "file";
  copy?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "title">;

export function Code({ source, lang, title, frame, copy = true, className, children, ...rest }: CodeProps) {
  const bar = frame || (title ? "file" : lang && SHELLS.includes(lang) ? "terminal" : undefined);
  const body = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    await navigator.clipboard.writeText((body.current?.innerText ?? "").replace(/\n$/, ""));
    button.classList.add("is-done");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => button.classList.remove("is-done"), 1500);
  };

  return (
    <div className={cx("ds-code", className, { "has-bar": bar })} {...rest}>
      {bar === "terminal" && (
        <div className="ds-code-bar" aria-hidden="true">
          <span className="ds-code-dots">
            <i />
            <i />
            <i />
          </span>
          {title && <span className="ds-code-title">{title}</span>}
        </div>
      )}
      {bar === "file" && (
        <div className="ds-code-bar">
          <span className="ds-code-title">{title}</span>
        </div>
      )}
      <div className="ds-code-body" ref={body}>
        {source != null ? (
          <pre>
            <code data-lang={lang}>{source.replace(/\n$/, "")}</code>
          </pre>
        ) : (
          children
        )}
      </div>
      {copy && <Button variant="ghost" size="sm" glyph="copy" label="Copy" className="ds-code-copy" onClick={onCopy} />}
    </div>
  );
}
