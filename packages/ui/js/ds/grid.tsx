import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Grid: children on a grid of columns, a count, a track list, or as many columns of at least `min` px as fit.
export type GridProps = {
  columns?: number | string;
  min?: number;
  gap?: number;
  align?: "stretch" | "start" | "center" | "end";
  width?: number;
  wrap?: boolean;
  tagName?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Grid({ columns = 2, min, gap = 16, align = "stretch", width, wrap = false, tagName: Tag = "div", className, style, children, ...rest }: GridProps) {
  const tracks = min
    ? `repeat(auto-fill, minmax(${min}px, 1fr))`
    : typeof columns === "number" ? `repeat(${columns}, minmax(0, 1fr))` : columns;
  const vars = { "--columns": tracks, "--gap": `${gap}px`, ...(width && { "--width": `${width}px` }), ...style } as CSSProperties;
  const classes = cx("ds-grid", `is-${align}`, className, { "has-width": width, "is-wrap": wrap });
  return (
    <Tag className={classes} style={vars} {...rest}>
      {children}
    </Tag>
  );
}
