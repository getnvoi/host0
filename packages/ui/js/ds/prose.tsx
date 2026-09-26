import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Prose: rich text written by a person or an agent at interface size; `read` sets it at reading size.
export type ProseProps = { read?: boolean; children?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Prose({ read = false, className, children, ...rest }: ProseProps) {
  return (
    <div className={cx("ds-prose", className, { "is-read": read })} {...rest}>
      {children}
    </div>
  );
}
