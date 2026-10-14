import type { HTMLAttributes } from "react";
import { cx } from "./cx";

// Ds::Actions: the actions that close a form, a dialog or a section, right-aligned, with a rule above at the foot of a
// surface.
export type ActionsProps = { rule?: boolean; align?: "start" | "end" | "between" } & HTMLAttributes<HTMLDivElement>;

export function Actions({ rule = false, align = "end", className, children, ...rest }: ActionsProps) {
  return (
    <div className={cx("ds-actions", `is-${align}`, className, { "has-rule": rule })} {...rest}>
      {children}
    </div>
  );
}
