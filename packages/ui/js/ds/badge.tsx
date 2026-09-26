import type { ComponentProps, CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { FAMILY, Icon } from "./icon";

// Ds::Badge: a mark. A category badge takes its family's pastel and icon; a kind badge names a thing in grey outline.
export type BadgeProps = {
  family?: string;
  icon?: ComponentProps<typeof Icon>["name"];
  glyph?: string | LucideIcon;
  kind?: boolean;
  href?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">;

export function Badge({ family, icon, glyph, kind = false, href, className, children, ...rest }: BadgeProps) {
  const classes = cx("ds-badge", className, {
    [`ds-f-${family}`]: family && !kind,
    "is-kind": kind,
    "has-icon": icon,
    "has-glyph": glyph && !icon,
    "is-link": href,
  });
  const face = icon && (family || (typeof icon === "string" && FAMILY[icon]) || "gray");
  const mark = icon ? (
    <Icon name={icon} family={face || undefined} size={16} style={{ "--f": "transparent" } as CSSProperties} />
  ) : (
    glyph && <Glyph name={glyph} size={12} />
  );
  const inner = (
    <>
      {mark}
      <span className="ds-badge-text">{children}</span>
    </>
  );
  if (href)
    return (
      <Link to={href} className={classes} {...rest}>
        {inner}
      </Link>
    );
  return (
    <span className={classes} {...rest}>
      {inner}
    </span>
  );
}
