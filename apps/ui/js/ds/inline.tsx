import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Inline: children in a row with one gap from the 4px scale, vertically centred by default.
export type InlineProps = {
  gap?: number;
  align?: "start" | "center" | "end" | "baseline" | "stretch";
  justify?: "start" | "end" | "between" | "center";
  wrap?: boolean;
  tagName?: ElementType;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Inline({ gap = 8, align = "center", justify = "start", wrap = true, tagName: Tag = "div", className, style, children, ...rest }: InlineProps) {
  const vars = { "--gap": `${gap}px`, ...style } as CSSProperties;
  const classes = cx("ds-inline", `is-align-${align}`, `is-justify-${justify}`, className, { "is-nowrap": !wrap });
  return (
    <Tag className={classes} style={vars} {...rest}>
      {children}
    </Tag>
  );
}
