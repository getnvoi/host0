import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Level: a surface drawn at one elevation, to compare them: flat, lifted, floating or backdrop.
export type LevelProps = {
  level?: "flat" | "lifted" | "floating" | "backdrop";
  pad?: number;
  width?: number;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Level({ level = "flat", pad = 12, width, className, style, children, ...rest }: LevelProps) {
  const vars = { "--pad": `${pad}px`, ...(width && { "--width": `${width}px` }), ...style } as CSSProperties;
  return (
    <div className={cx("ds-level", `is-${level}`, className, { "has-width": width })} style={vars} {...rest}>
      {level === "backdrop" ? <div className="ds-level-card">{children}</div> : children}
    </div>
  );
}
