import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";

// Ds::Panel: a dialog's panel drawn in the page instead of over it, for showing what a dialog says.
export type PanelProps = {
  title: ReactNode;
  text?: ReactNode;
  size?: "sm" | "md";
  close?: boolean;
  foot?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "title">;

export function Panel({ title, text, size = "sm", close = false, foot, className, children, ...rest }: PanelProps) {
  return (
    <div className={cx("ds-panel", `is-${size}`, className)} {...rest}>
      <div className={cx("ds-panel-body", { "has-close": close })}>
        <div className="ds-panel-title">{title}</div>
        {text && <p className="ds-panel-text">{text}</p>}
        {children != null && children !== false && <div className="ds-panel-content">{children}</div>}
      </div>
      {foot && <div className="ds-panel-foot">{foot}</div>}
      {close && (
        <span className="ds-panel-close">
          <Button size="sm" glyph="close" label="Close" />
        </span>
      )}
    </div>
  );
}
