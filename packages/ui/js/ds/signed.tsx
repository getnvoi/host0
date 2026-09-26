import { useEffect, useRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { FAMILY, Icon, LABELS } from "./icon";
import { Prose } from "./prose";
import { Status } from "./status";

type Attrs<T = HTMLElement> = Omit<HTMLAttributes<T>, "children">;

// A link inside the app goes through the router; anything with a scheme, or a fragment, is a plain anchor.
function Anchor({ href, ...rest }: { href: string } & HTMLAttributes<HTMLAnchorElement>) {
  return /^([a-z]+:|#)/.test(href) ? <a href={href} {...rest} /> : <Link to={href} {...rest} />;
}

// A tool's label: its family label, else its name capitalised.
export const runLabel = (tool: string) => LABELS[tool] ?? tool.charAt(0).toUpperCase() + tool.slice(1).toLowerCase();

// 1234 → "1.2k tokens"; a string is shown as given.
export function signedTokens(value: number | string): string {
  if (typeof value === "string") return value;
  const short = value < 1000 ? String(value) : `${String(Math.round(value / 100) / 10).replace(/\.0$/, "")}k`;
  return `${short} tokens`;
}

// Ds::Signed: work signed by an agent, a label tab with its face and mono name over an ink-edged box of its parts.
export type SignedProps = {
  name: string;
  icon?: string;
  family?: string;
  meta?: ReactNode;
  continued?: boolean;
  children?: ReactNode;
} & Attrs;

export function Signed({ name, icon = "agent", family, meta, continued = false, className, children, ...rest }: SignedProps) {
  const face = family ?? FAMILY[icon] ?? "blue";
  return (
    <article className={cx("ds-signed", `ds-f-${face}`, className, { "is-continued": continued })} aria-label={name} {...rest}>
      {!continued && (
        <div className="ds-signed-head">
          <span className="ds-signed-tab">
            <span className="ds-signed-face">
              <Icon name={icon} family={face} size={20} style={{ "--f": "transparent" } as CSSProperties} />
            </span>
            <span className="ds-signed-name">{name}</span>
          </span>
          {meta != null && <span className="ds-signed-meta">{meta}</span>}
        </div>
      )}
      <div className="ds-signed-box">{children}</div>
    </article>
  );
}

// Ds::Signed::Prose: what the agent said, as a part of a signed box: its words as rich text.
export function SignedProse({ className, children, ...rest }: { children?: ReactNode } & Attrs<HTMLDivElement>) {
  return (
    <div className={cx("ds-signed-prose", className)} {...rest}>
      <Prose>{children}</Prose>
    </div>
  );
}

// Ds::Signed::Error: what went wrong in a signed box, a red dot and what failed, then the message as printed.
export function SignedError({ title, className, children, ...rest }: { title: ReactNode; children?: ReactNode } & Attrs<HTMLDivElement>) {
  return (
    <div className={cx("ds-signed-error", className)} role="alert" {...rest}>
      <div className="ds-signed-error-head">
        <Status state="bad">{title}</Status>
      </div>
      {children != null && children !== false && <pre className="ds-signed-output">{children}</pre>}
    </div>
  );
}

// Ds::Signed::Run: one tool call in a signed box, its face, name, exact command, then time and tokens; opens to its
// output or to its own panes (children).
export type SignedRunProps = {
  tool: string;
  command: string;
  label?: string;
  time?: string;
  tokens?: number | string;
  state?: "done" | "running" | "failed";
  output?: string;
  open?: boolean;
  children?: ReactNode;
} & Attrs;

export function SignedRun({
  tool, command, label, time, tokens, state = "done", output, open = false, className, children, ...rest
}: SignedRunProps) {
  const name = label ?? runLabel(tool);
  const content = children != null && children !== false;
  const opens = output != null || content;
  const facts = [time, tokens != null ? signedTokens(tokens) : null].filter((f) => f != null).join(" · ");
  const classes = cx("ds-signed-run", `is-${state}`, className);
  const row = (
    <>
      <Icon name={tool} size={20} />
      <span className="ds-signed-tool">{name}</span>
      <span className="ds-signed-command" title={command}>{command}</span>
      <span className="ds-signed-end">
        {state === "running" ? (
          <>
            <span className="ds-signed-spin" aria-hidden="true" />
            <span>Running</span>
          </>
        ) : state === "failed" ? (
          <>
            <Status state="bad">Failed</Status>
            {facts && <span>{facts}</span>}
          </>
        ) : (
          <span>{facts}</span>
        )}
        {opens && <Glyph name="chevron-right" size={14} className="ds-signed-chevron" />}
      </span>
    </>
  );
  if (opens) {
    return (
      <details className={classes} open={open} {...rest}>
        <summary className="ds-signed-row">{row}</summary>
        {content ? children : <pre className="ds-signed-output">{output}</pre>}
      </details>
    );
  }
  return (
    <div className={classes} {...rest}>
      <div className="ds-signed-row">{row}</div>
    </div>
  );
}

// Keeps a scrolling element on its newest line while the reader is at the bottom; a reader who scrolled up keeps
// their place. Same rule as ds/log.
function useFollow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let pinned = true;
    element.scrollTop = element.scrollHeight;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      pinned = scrollHeight - scrollTop - clientHeight < 8;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new MutationObserver(() => {
      element.querySelector(":scope > .ds-log-empty")?.remove();
      if (pinned) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element, { childList: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, []);
  return ref;
}

// Ds::Signed::Pane: a pane under a run that lines are appended to, one span per line in the run's output style; it
// follows the newest line unless the reader scrolled up.
export function SignedPane({ lines = [], className, ...rest }: { lines?: ReactNode[] } & Attrs<HTMLPreElement>) {
  const ref = useFollow<HTMLPreElement>();
  return (
    <pre ref={ref} className={cx("ds-signed-output", className)} tabIndex={0} {...rest}>
      {lines.map((line, i) => (
        <span key={i}>{line}{"\n"}</span>
      ))}
    </pre>
  );
}

// Ds::Signed::Actions: a run of tool calls in a signed box under one counter, "3 actions" and their total time. With
// an id, its counter is `<id>-head` and its rows' list `<id>-list`; `head` renders the counter alone.
export type SignedActionsProps = {
  count: number;
  time?: ReactNode;
  open?: boolean;
  head?: boolean;
  children?: ReactNode;
} & Attrs<HTMLDetailsElement>;

export function SignedActions({ count, time, open = false, head = false, id, className, children, ...rest }: SignedActionsProps) {
  const part = (name: string) => (id ? `${id}-${name}` : undefined);
  const counter = (
    <summary className="ds-signed-actions-head" id={part("head")}>
      <Glyph name="chevron-right" size={14} className="ds-signed-chevron" />
      <span className="ds-signed-actions-count">{`${count} ${count === 1 ? "action" : "actions"}`}</span>
      {time != null && <span className="ds-signed-actions-time">{time}</span>}
    </summary>
  );
  if (head) return counter;
  return (
    <details className={cx("ds-signed-actions", className)} open={open} id={id} {...rest}>
      {counter}
      <div className="ds-signed-actions-list" id={part("list")}>{children}</div>
    </details>
  );
}

// Ds::Signed::Subagents: the sub-agents an agent sent, as one card: a tally, then a row each with its mark, face, name,
// last line and time · tools · tokens.
export type SignedSubagent = {
  name: ReactNode;
  line?: ReactNode;
  state?: "done" | "running" | "failed";
  time?: string;
  tools?: number;
  tokens?: number | string;
  href?: string;
};

export function SignedSubagents({
  agents, title = "Sub-agents", className, ...rest
}: { agents: SignedSubagent[]; title?: string } & Attrs<HTMLDivElement>) {
  const counts: Record<string, number> = {};
  for (const agent of agents) counts[agent.state ?? "done"] = (counts[agent.state ?? "done"] ?? 0) + 1;
  const tally = [title, ...(["done", "running", "failed"] as const).filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`)].join(" · ");
  const facts = (agent: SignedSubagent) =>
    [
      agent.time,
      agent.tools != null ? `${agent.tools} ${agent.tools === 1 ? "tool" : "tools"}` : null,
      agent.tokens != null ? signedTokens(agent.tokens) : null,
    ]
      .filter((f) => f != null)
      .join(" · ");
  return (
    <div className={cx("ds-signed-subagents", className)} {...rest}>
      <div className="ds-signed-tally">{tally}</div>
      {agents.map((agent, i) => {
        const state = agent.state ?? "done";
        const inner = (
          <>
            <span className="ds-signed-mark" role="img" aria-label={state.charAt(0).toUpperCase() + state.slice(1)}>
              {state === "running" ? (
                <span className="ds-signed-spin" />
              ) : state === "failed" ? (
                <span className="ds-signed-dot" />
              ) : (
                <Glyph name="check" size={12} />
              )}
            </span>
            <Icon name="subagent" size={20} />
            <span className="ds-signed-subname">{agent.name}</span>
            <span className="ds-signed-line">{agent.line}</span>
            <span className="ds-signed-facts">{facts(agent)}</span>
          </>
        );
        const classes = `ds-signed-sub is-${state}`;
        return agent.href ? (
          <Anchor key={i} href={agent.href} className={classes}>{inner}</Anchor>
        ) : (
          <div key={i} className={classes}>{inner}</div>
        );
      })}
    </div>
  );
}

// Ds::Signed::Pictures: pictures the agent took during a turn, as thumbnails with their names. Each is a link to the
// full picture, or a button when its attrs hand it to a lightbox.
export type SignedPicture = { name: string; src: string; href?: string; attrs?: HTMLAttributes<HTMLElement> };

export function SignedPictures({
  pictures, label = "Pictures", className, ...rest
}: { pictures: SignedPicture[]; label?: string } & Attrs<HTMLUListElement>) {
  return (
    <ul className={cx("ds-signed-pictures", className)} aria-label={label} {...rest}>
      {pictures.map((item, i) => {
        const inner = (
          <>
            <img src={item.src} alt="" />
            <span className="ds-signed-picture-name">{item.name}</span>
          </>
        );
        return (
          <li key={i}>
            {item.href ? (
              <a href={item.href} className="ds-signed-picture" title={item.name} {...item.attrs}>{inner}</a>
            ) : (
              <button type="button" aria-label={`Open ${item.name}`} className="ds-signed-picture" title={item.name} {...item.attrs}>
                {inner}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
