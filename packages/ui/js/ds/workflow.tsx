import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "./badge";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { Icon } from "./icon";

// A step of a workflow; `href` is its session once started, `current` the one in view.
export type WorkflowStep = {
  name: string;
  agent?: ReactNode;
  gate?: ReactNode;
  manual?: boolean;
  state: "done" | "now" | "next";
  href?: string;
  current?: boolean;
};

// Ds::Workflow: a workflow's progress over the composer, one line with the workflow, the step in progress and a
// segment per step; opened, the steps with their agent, gate and advance.
export type WorkflowProps = {
  name: ReactNode;
  steps: WorkflowStep[];
  word?: string;
  open?: boolean;
} & Omit<HTMLAttributes<HTMLDetailsElement>, "children">;

export function Workflow({ name, steps, word, open = false, className, ...rest }: WorkflowProps) {
  // The step in progress, else the next to start, else the last.
  const current = steps.find((s) => s.state === "now") ?? steps.find((s) => s.state === "next") ?? steps[steps.length - 1];
  const number = (current ? steps.indexOf(current) : 0) + 1;
  const line = [`Step ${number} of ${steps.length}`, current?.name, word].filter((part) => part != null).join(" · ");
  return (
    <details className={cx("ds-workflow", className)} open={open} {...rest}>
      <summary className="ds-workflow-line">
        <Icon name="plan" size={20} />
        <span className="ds-workflow-name">{name}</span>
        <span className="ds-workflow-now">{line}</span>
        <span className="ds-workflow-segments" aria-hidden="true">
          {steps.map((s, i) => (
            <i key={i} className={`is-${s.state}`} />
          ))}
        </span>
        <Glyph name="chevron-down" size={14} className="ds-workflow-chevron" />
      </summary>
      <ol className="ds-workflow-steps">
        {steps.map((s, i) => (
          <li key={i} className={cx("ds-workflow-step", `is-${s.state}`, { "is-current": s.current })}>
            <span className="ds-workflow-number">{s.state === "done" ? <Glyph name="check" size={12} /> : i + 1}</span>
            {/* The mark says done or not yet; only the step in progress says what it is doing. */}
            <span className="ds-workflow-step-name">
              {s.href ? (
                <Link to={s.href} className="ds-workflow-link" aria-current={s.current ? "page" : undefined}>
                  {s.name}
                </Link>
              ) : (
                s.name
              )}
              {s.state === "now" && <span className="ds-workflow-state">{word ?? "running"}</span>}
            </span>
            <span className="ds-workflow-advance">
              <Badge kind>{s.manual ? "Manual" : "Auto"}</Badge>
            </span>
            <span className="ds-workflow-meta">
              <span>{s.agent}</span>
              {s.gate ? (
                <span>
                  gate <code>{s.gate}</code>
                </span>
              ) : (
                <span>no gate</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
