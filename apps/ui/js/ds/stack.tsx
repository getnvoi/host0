import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Stack: children in a column with one gap from the 4px scale.
export type StackProps = {
  gap?: 0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 48;
  width?: number | "full";
  align?: "stretch" | "start" | "center" | "end";
  center?: boolean;
  tagName?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Stack({ gap = 12, width, align = "stretch", center = false, tagName: Tag = "div", className, style, children, ...rest }: StackProps) {
  const sized = typeof width === "number";
  const vars = { "--gap": `${gap}px`, ...(sized && { "--width": `${width}px` }), ...style } as CSSProperties;
  const classes = cx("ds-stack", `is-${align}`, className, { "is-centered": center, "has-width": sized, "is-full": width === "full" });
  return (
    <Tag className={classes} style={vars} {...rest}>
      {children}
    </Tag>
  );
}
