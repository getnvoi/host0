import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Text: text in one of the named styles, so no example sets a font by hand.
export type TextProps = {
  as?: "display" | "title" | "dialog" | "head" | "box" | "body" | "read" | "strong" | "caption" | "label" | "name" | "meta" | "number" | "mono";
  tagName?: ElementType;
  truncate?: boolean;
  grow?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Text({ as = "body", tagName: Tag = "span", truncate = false, grow = false, className, children, ...rest }: TextProps) {
  return (
    <Tag className={cx("ds-text", `is-${as}`, className, { "is-truncate": truncate, "is-grow": grow })} {...rest}>
      {children}
    </Tag>
  );
}
