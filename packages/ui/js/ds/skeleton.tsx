import { Fragment, type CSSProperties, type HTMLAttributes } from "react";
import { cx } from "./cx";
import { px, type PageWidth } from "./page";

const bone = (...kinds: string[]) => <i className={cx("ds-skeleton-bone", ...kinds.map((k) => `is-${k}`))} />;

const lines = (rows: number) => (
  <div className="ds-skeleton-lines">
    {Array.from({ length: rows }, (_, i) => (
      <i key={i} className="ds-skeleton-bone is-text" />
    ))}
  </div>
);

const row = (key?: number) => (
  <div key={key} className="ds-skeleton-row">
    <span className="ds-skeleton-name">
      <span className="ds-lead">{bone("disc")}</span>
      <span className="ds-skeleton-words">
        {bone("title")}
        {bone("line")}
      </span>
    </span>
    {bone("cell")}
    {bone("cell", "short")}
  </div>
);

const section = (rows: number, key?: number) => (
  <Fragment key={key}>
    <div className="ds-skeleton-tab">{bone("tab")}</div>
    <div className="ds-skeleton-box">{lines(rows)}</div>
  </Fragment>
);

// Ds::Skeleton: the shape of what is loading, drawn at the size of the real thing so nothing moves when it arrives.
export type SkeletonProps = {
  shape?: "list" | "page" | "row" | "section" | "text";
  rows?: number;
  width?: PageWidth;
  label?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Skeleton({ shape = "row", rows = 3, width = "narrow", label = "Loading", className, style, ...rest }: SkeletonProps) {
  const vars = shape === "page" ? ({ "--width": `${px(width)}px`, ...style } as CSSProperties) : style;
  let bones;
  if (shape === "row") bones = row();
  else if (shape === "list")
    bones = (
      <>
        <div className="ds-skeleton-head">
          {bone("caption")}
          {bone("caption")}
          {bone("caption")}
        </div>
        {Array.from({ length: rows }, (_, i) => row(i))}
      </>
    );
  else if (shape === "section") bones = section(rows);
  else if (shape === "page")
    // A centred column: the page title, then a section per row count, three at most.
    bones = (
      <>
        <div className="ds-skeleton-title">
          {bone("heading")}
          {bone("line")}
        </div>
        {Array.from({ length: Math.min(rows, 3) }, (_, i) => section(rows, i))}
      </>
    );
  else bones = lines(rows);
  return (
    <div className={cx("ds-skeleton", `is-${shape}`, className)} style={vars} role="status" aria-busy="true" aria-label={label} {...rest}>
      <div className="ds-skeleton-bones" aria-hidden="true">
        {bones}
      </div>
    </div>
  );
}
