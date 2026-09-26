import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Aside: the last row of a form page, one discreet action on the thing itself; nothing when given nothing.
export type AsideProps = { children?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Aside({ className, children, ...rest }: AsideProps) {
  if (children == null || children === false || children === "") return null;
  return (
    <div className={cx("ds-aside", className)} {...rest}>
      {children}
    </div>
  );
}
