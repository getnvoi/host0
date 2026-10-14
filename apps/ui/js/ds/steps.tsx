import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { Glyph } from "./glyph";

// Ds::Steps: the steps of a flow as a band of equal cells between vertical dividers, the current one underlined. A
// done step shows its answer under its name and links back to it.
export type StepsItem = { label: ReactNode; value?: ReactNode; href?: string; state?: "done" | "current" | "todo"; onClick?: () => void };

export function Steps({ items, label = "Steps", className, ...rest }: { items: StepsItem[]; label?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <nav className={cx("ds-steps", className)} aria-label={label} {...rest}>
      <ol className="ds-steps-list">
        {items.map((item, i) => {
          const state = item.state ?? "todo";
          const body = (
            <>
              <span className="ds-steps-mark" aria-hidden>
                {state === "done" ? <Glyph name="check" size={12} /> : i + 1}
              </span>
              {state === "done" && item.value ? (
                <span className="ds-steps-words">
                  <small>{item.label}</small>
                  <span className="ds-steps-value">{item.value}</span>
                </span>
              ) : (
                <span className="ds-steps-words">
                  <span className="ds-steps-value">{item.label}</span>
                </span>
              )}
            </>
          );
          const classes = cx("ds-steps-step", `is-${state}`);
          return (
            <li key={i}>
              {item.href && state !== "current" ? (
                <Link to={item.href} className={classes} onClick={item.onClick}>
                  {body}
                </Link>
              ) : (
                <span className={classes} aria-current={state === "current" ? "step" : undefined}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
