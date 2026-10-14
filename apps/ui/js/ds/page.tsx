import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// A column's width by what the page is: compact for sign-in, form for anything that edits, narrow for detail and
// session pages, wide for a framed page. A number is taken as pixels.
export const WIDTHS = { compact: 400, form: 720, narrow: 880, wide: 1040 } as const;
export type PageWidth = keyof typeof WIDTHS | number;
export const px = (width: PageWidth) => (typeof width === "number" ? width : WIDTHS[width]);

// Ds::Page: the frame of an app page, the head fixed over one scroll area holding the body in a list or a column.
export type PageProps = {
  layout?: "list" | "column";
  width?: PageWidth;
  flush?: boolean;
  head?: ReactNode;
  tabs?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Page({ layout = "list", width = "narrow", flush = false, head, tabs, foot, className, style, children, ...rest }: PageProps) {
  const vars = { "--width": `${px(width)}px`, ...style } as CSSProperties;
  return (
    <div className={cx("ds-page", `is-${layout}`, className, { "is-flush": flush })} style={vars} {...rest}>
      {head}
      {tabs && (
        <div className="ds-page-tabs">
          <div className="ds-page-tabs-in">{tabs}</div>
        </div>
      )}
      <div className="ds-page-scroll">
        <div className="ds-page-body">{children}</div>
      </div>
      {foot && (
        <div className="ds-page-foot">
          <div className="ds-page-foot-in">{foot}</div>
        </div>
      )}
    </div>
  );
}
