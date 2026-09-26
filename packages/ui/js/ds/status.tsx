import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Status: state as a dot and a word. The word is required: colour alone never carries the state.
export type StatusProps = {
  state?: "ok" | "busy" | "bad" | "idle";
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Status({ state = "idle", className, children, ...rest }: StatusProps) {
  return (
    <span className={cx("ds-status", `is-${state}`, className)} {...rest}>
      <span className="ds-status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}
