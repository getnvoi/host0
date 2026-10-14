import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Box: a square surface; the edge says what it is, the fill is white unless it is a muted or paper ground.
export type BoxProps = {
  edge?: "none" | "divider" | "section" | "control" | "ink";
  fill?: "surface" | "muted" | "paper" | "none";
  pad?: number;
  width?: number | "full";
  center?: boolean;
  tagName?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Box({ edge = "divider", fill = "surface", pad = 0, width, center = false, tagName: Tag = "div", className, style, children, ...rest }: BoxProps) {
  const sized = typeof width === "number";
  const vars = { "--pad": `${pad}px`, ...(sized && { "--width": `${width}px` }), ...style } as CSSProperties;
  const classes = cx("ds-box", `is-${edge}`, `is-fill-${fill}`, className, {
    "has-width": sized,
    "is-full": width === "full",
    "is-centered": center,
  });
  return (
    <Tag className={classes} style={vars} {...rest}>
      {children}
    </Tag>
  );
}
