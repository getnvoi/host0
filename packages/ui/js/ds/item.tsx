import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Count } from "./count";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { Icon } from "./icon";

// Ds::Item: one row of a menu or a nav drawn in place, in a state it can be shown in, for showing what rows look like.
export type ItemProps = {
  glyph?: string | LucideIcon;
  icon?: ComponentProps<typeof Icon>["name"];
  state?: "rest" | "hover" | "selected" | "focus" | "off";
  trail?: string | LucideIcon;
  count?: number;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Item({ glyph, icon, state = "rest", trail, count, className, children, ...rest }: ItemProps) {
  return (
    <div className={cx("ds-item", `is-${state}`, className)} {...rest}>
      {icon ? <Icon name={icon} size={20} /> : glyph && <Glyph name={glyph} className="ds-item-glyph" />}
      <span className="ds-item-label">{children}</span>
      {count != null && <Count value={count} />}
      {trail && <Glyph name={trail} className="ds-item-trail" />}
    </div>
  );
}
