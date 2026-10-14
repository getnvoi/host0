import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./cx";

// Ds::Step: one step of the spacing scale, its value in pixels, then a bar four times that long.
export type StepProps = { value: number } & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Step({ value, className, style, ...rest }: StepProps) {
  return (
    <div className={cx("ds-step", className)} style={{ "--step": value, ...style } as CSSProperties} {...rest}>
      <span className="ds-step-value">{value}</span>
      <span className="ds-step-bar" aria-hidden="true" />
    </div>
  );
}
