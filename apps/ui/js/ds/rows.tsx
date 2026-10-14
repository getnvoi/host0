import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

// Ds::Rows: blocks stacked and split by g6 rules, each padded the same; it draws no outer edge.
export type RowsProps = { items: ReactNode[]; pad?: number; inset?: number } & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Rows({ items, pad = 12, inset = 16, className, style, ...rest }: RowsProps) {
  const vars = { "--pad": `${pad}px`, "--inset": `${inset}px`, ...style } as CSSProperties;
  return (
    <div className={cx("ds-rows", className)} style={vars} {...rest}>
      {items.map((item, i) => (
        <div key={i} className="ds-rows-item">
          {item}
        </div>
      ))}
    </div>
  );
}
