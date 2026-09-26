import { Children, useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "./badge";
import { Count } from "./count";
import { cx } from "./cx";
import { Place } from "./place";

// Ds::Board: things as lanes of cards side by side, each lane a section whose tab carries its state dot and count,
// its cards on a grey ground. It scrolls sideways rather than squeezing a lane under 240px. Its children are
// BoardLane elements.
export function Board({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const lanes = Children.toArray(children);
  return (
    <div className={cx("ds-board", className)} {...rest}>
      <div className="ds-board-lanes" style={{ "--lanes": lanes.length } as CSSProperties}>
        {lanes}
      </div>
    </div>
  );
}

export type BoardLaneProps = {
  name: string;
  state?: "ok" | "busy" | "bad" | "idle";
  family?: string;
  count?: number;
  empty?: ReactNode;
  children?: ReactNode;
};

// One lane of a board: a section whose tab carries its state dot and count, its cards, or the empty line. The
// section's markup is written here (Ds::Section with name, dot, family, count).
export function BoardLane({ name, state, family = "gray", count, empty = "Nothing here", children }: BoardLaneProps) {
  const id = `section-${useId().replace(/:/g, "")}`;
  const body = Children.toArray(children).length ? children : <p className="ds-board-empty">{empty}</p>;
  return (
    <section className={cx("ds-section", "ds-board-lane", `ds-f-${family}`, { "has-icon": state })} aria-labelledby={id}>
      <div className="ds-section-bar">
        <div className="ds-section-tab">
          {state && (
            <span className="ds-section-icon">
              <span className={`ds-section-dot is-${state}`} aria-hidden />
            </span>
          )}
          <h2 className="ds-section-name" id={id}>
            {name}
            {count != null && <Count value={count} />}
          </h2>
        </div>
      </div>
      <div className="ds-section-box">
        <div className="ds-section-body">{body}</div>
      </div>
    </section>
  );
}

export type BoardCardProps = {
  title: ReactNode;
  href: string;
  // ok, busy or bad, with its word in `status`; spin turns a ring in place of the dot.
  state?: "ok" | "busy" | "bad";
  status?: ReactNode;
  spin?: boolean;
  place?: string;
  // Who the place belongs to, small over it: a repository's owner.
  scope?: string;
  badge?: ReactNode;
  // The age, as markup (a time element).
  time?: ReactNode;
  off?: boolean;
  className?: string;
};

// One card of a board lane, a link to the thing: its title; its state while it is doing something; where it is and
// its age.
export function BoardCard({ title, href, state, status, spin = false, place, scope, badge, time, off = false, className }: BoardCardProps) {
  const meta = [
    place && <Place key="place" name={place} owner={scope} />,
    badge && (
      <Badge key="badge" kind>
        {badge}
      </Badge>
    ),
    time && (
      <span key="time" className="ds-board-card-time">
        {time}
      </span>
    ),
  ].filter(Boolean);
  const inner = (
    <>
      <span className="ds-board-card-title">{title}</span>
      {status && (
        <span className="ds-board-card-state">
          {spin ? <span className="ds-board-card-spin" aria-hidden /> : <span className={`ds-board-card-dot is-${state}`} aria-hidden />}
          {status}
        </span>
      )}
      {meta.length > 0 && <span className="ds-board-card-meta">{meta}</span>}
    </>
  );
  const classes = cx("ds-board-card", className, { "is-off": off });
  return /^[a-z]+:/.test(href) ? (
    <a href={href} className={classes}>
      {inner}
    </a>
  ) : (
    <Link to={href} className={classes}>
      {inner}
    </Link>
  );
}
