import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// One number of a Ds::Stats.
export type StatsItem = { label: ReactNode; value: ReactNode; text?: ReactNode; state?: "ok" | "busy" | "bad" | "idle" };

// Ds::Stats: two to four numbers in a row, each under its label and over a line that says what it counts.
export type StatsProps = { label?: string; items: StatsItem[] } & Omit<HTMLAttributes<HTMLDListElement>, "children">;

export function Stats({ label, items, className, ...rest }: StatsProps) {
  return (
    <dl className={cx("ds-stats", `is-${items.length}`, className)} aria-label={label} {...rest}>
      {items.map((item, i) => (
        <StatsItem key={i} {...item} />
      ))}
    </dl>
  );
}

export function StatsItem({ label, value, text, state }: StatsItem) {
  return (
    <div className="ds-stats-item">
      <dt className="ds-stats-label">{label}</dt>
      <dd className="ds-stats-value">
        {state && <span className={`ds-stats-dot is-${state}`} aria-hidden="true" />}
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </dd>
      {text && <dd className="ds-stats-text">{text}</dd>}
    </div>
  );
}
