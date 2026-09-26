import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Glyph } from "./glyph";

// Ds::Button: a pill that does one thing. Solid is the one primary action of a view, outline the secondary, line the
// secondary on paper, ghost the quiet; warning for what is missing before the thing works; danger only for what
// destroys. `href` makes it a link. With no children it is a round glyph button and needs a label.
export type ButtonProps = {
  variant?: "solid" | "outline" | "line" | "ghost" | "warning" | "danger";
  size?: "md" | "sm";
  glyph?: string | LucideIcon;
  glyphAfter?: string | LucideIcon;
  label?: string;
  href?: string;
  loading?: boolean;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel">;

export function Button({
  variant = "outline",
  size = "md",
  glyph,
  glyphAfter,
  label,
  href,
  loading = false,
  disabled = false,
  type = "button",
  className,
  children,
  target,
  rel,
  ...rest
}: ButtonProps) {
  const px = size === "sm" ? 12 : 14;
  const classes = cx("ds-button", className, `is-${variant}`, `is-${size}`, {
    "is-glyph": !children && glyph,
    "is-loading": loading,
  });
  const inner = (
    <>
      {loading ? <span className="ds-button-spin" aria-hidden /> : glyph && <Glyph name={glyph} size={px} />}
      {children}
      {glyphAfter && <Glyph name={glyphAfter} size={px} />}
    </>
  );
  if (href && !disabled) {
    const external = /^[a-z]+:/.test(href);
    return external ? (
      <a href={href} className={classes} aria-label={label} target={target} rel={rel}>
        {inner}
      </a>
    ) : (
      <Link to={href} className={classes} aria-label={label}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-label={label} aria-busy={loading || undefined} {...rest}>
      {inner}
    </button>
  );
}
