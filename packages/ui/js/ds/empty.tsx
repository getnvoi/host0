import type { ComponentProps, ElementType, HTMLAttributes, ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { FAMILY, Icon } from "./icon";

// Ds::Empty: a dashed frame for a place with nothing in it, the category's icon, a title, one line and one action.
export type EmptyProps = {
  title?: ReactNode;
  icon?: ComponentProps<typeof Icon>["name"];
  text?: ReactNode;
  filtered?: boolean;
  clear?: string;
  clearLabel?: string;
  heading?: ElementType;
  action?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "title">;

export function Empty({ title, icon, text, filtered = false, clear, clearLabel = "Clear search", heading: Heading = "h2", action, className, ...rest }: EmptyProps) {
  const family = filtered ? "off" : (typeof icon === "string" && FAMILY[icon]) || "gray";
  const button = filtered && clear && (
    <Button href={clear} glyph="close">
      {clearLabel}
    </Button>
  );
  return (
    <div className={cx("ds-empty", className, { "is-filtered": filtered })} {...rest}>
      {icon && <Icon name={icon} size={64} family={family} className="ds-empty-icon" />}
      <Heading className="ds-empty-title">{title || "Nothing matches"}</Heading>
      {text && <p className="ds-empty-text">{text}</p>}
      {(button || action) && (
        <div className="ds-empty-action">
          {button}
          {action}
        </div>
      )}
    </div>
  );
}
