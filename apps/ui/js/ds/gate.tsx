import { Fragment, useState } from "react";
import type { FormEvent, HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "./button";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { Icon } from "./icon";
import { runLabel } from "./signed";
import { Status } from "./status";

type Attrs<T = HTMLElement> = Omit<HTMLAttributes<T>, "children">;

export type GateDecision = "approve" | "reject";

// Ds::Gate: a tool call waiting for approval. Pending, it floats in the yellow family with the tool's face, the exact
// action and Deny then Allow; decided, it is one quiet row with the verdict and a link to replay it. `onDecide` stands
// for the Rails form (`url`): both buttons go quiet once a decision is sent, so it cannot be sent twice.
export type GateProps = {
  tool: string;
  action: string;
  label?: string;
  state?: "pending" | "allowed" | "denied";
  details?: Record<string, ReactNode>;
  agent?: ReactNode;
  onDecide?: (decision: GateDecision) => void;
  sending?: boolean;
  meta?: ReactNode;
  replay?: string;
  replayFor?: string;
} & Attrs;

export function Gate({
  tool, action, label, state = "pending", details = {}, agent, onDecide, sending = false, meta, replay, replayFor,
  className, ...rest
}: GateProps) {
  const [decided, setDecided] = useState(false);
  const name = label ?? runLabel(tool);
  const pending = state === "pending";
  const classes = cx("ds-gate", `is-${state}`, className, { "ds-f-yellow": pending });

  if (pending) {
    const type = onDecide ? "submit" : "button";
    const buttons = (
      <>
        <Button glyph="close" type={type} disabled={sending || decided} name="decision" value="reject">Deny</Button>
        <Button variant="solid" glyph="check" type={type} loading={sending} disabled={decided} name="decision" value="approve">
          Allow
        </Button>
      </>
    );
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      requestAnimationFrame(() => setDecided(true));
      onDecide?.(submitter?.value === "reject" ? "reject" : "approve");
    };
    const entries = Object.entries(details);
    return (
      <section className={classes} aria-label={`${name} needs your approval`} {...rest}>
        <div className="ds-gate-head">
          <Icon name={tool} size={24} />
          <span className="ds-gate-tool">{name}</span>
          <Status state="busy" className="ds-gate-ask">Needs your approval</Status>
        </div>
        <pre className="ds-gate-action">{action}</pre>
        {entries.length > 0 && (
          <dl className="ds-gate-details">
            {entries.map(([term, value]) => (
              <Fragment key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
        <div className="ds-gate-foot">
          {agent != null && (
            <span className="ds-gate-agent">
              Asked by <span className="ds-gate-name">{agent}</span>
            </span>
          )}
          {onDecide ? (
            <form className="ds-gate-buttons" onSubmit={submit}>{buttons}</form>
          ) : (
            <span className="ds-gate-buttons">{buttons}</span>
          )}
        </div>
      </section>
    );
  }

  const [tone, word] = state === "allowed" ? (["ok", "Allowed"] as const) : (["bad", "Denied"] as const);
  const replayLabel = `Replay the ${name} call`;
  return (
    <div className={classes} {...rest}>
      <Icon name={tool} size={20} />
      <span className="ds-gate-tool">{name}</span>
      <span className="ds-gate-line" title={action}>{action}</span>
      {meta != null && <span className="ds-gate-meta">{meta}</span>}
      <Status state={tone}>{word}</Status>
      {replayFor ? (
        <button type="button" className="ds-gate-replay" {...{ commandfor: replayFor, command: "show-modal" }} aria-label={replayLabel}>
          <Glyph name="arrow-up-right" size={14} />
        </button>
      ) : replay ? (
        /^([a-z]+:|#)/.test(replay) ? (
          <a className="ds-gate-replay" href={replay} aria-label={replayLabel}><Glyph name="arrow-up-right" size={14} /></a>
        ) : (
          <Link className="ds-gate-replay" to={replay} aria-label={replayLabel}><Glyph name="arrow-up-right" size={14} /></Link>
        )
      ) : null}
    </div>
  );
}

// Ds::Gate::Stack: every call waiting on you, stacked right above the composer, oldest first.
export function GateStack({ className, children, ...rest }: { children?: ReactNode } & Attrs<HTMLDivElement>) {
  return (
    <div className={cx("ds-gate-stack", className)} role="region" aria-label="Approvals" {...rest}>
      {children}
    </div>
  );
}
