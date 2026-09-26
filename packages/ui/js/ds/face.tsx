import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Face: words set in one of the five faces at the size it is shown at, to show the face itself.
export type FaceProps = {
  face: "display" | "serif" | "sans" | "mono" | "pixel";
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Face({ face, className, children, ...rest }: FaceProps) {
  return (
    <span className={cx("ds-face", `is-${face}`, className)} {...rest}>
      {children}
    </span>
  );
}
