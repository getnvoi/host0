import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./cx";

// Ds::Window: a real screen shown on a page or a post, a white window with an ink edge, centred on paper. The content
// is not interactive.
export type WindowProps = { width?: number } & HTMLAttributes<HTMLDivElement>;

export function Window({ width = 640, className, children, ...rest }: WindowProps) {
  return (
    <div className={cx("ds-window", className)} {...rest}>
      <div className="ds-window-in" style={{ "--w": `${width}px` } as CSSProperties} aria-hidden inert>
        {children}
      </div>
    </div>
  );
}
