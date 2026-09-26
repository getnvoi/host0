import type { HTMLAttributes } from "react";
import { cx } from "./cx";

// Large numbers shorten: 1.2k, 3.4M.
export function short(value: number): string {
  if (value < 1000) return String(value);
  const round = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");
  if (value < 1_000_000) return `${round(value / 1000)}k`;
  return `${round(value / 1_000_000)}M`;
}

// Ds::Count: a number in a round cell, after the label it counts.
export type CountProps = { value: number } & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Count({ value, className, ...rest }: CountProps) {
  return (
    <span className={cx("ds-count", className)} title={String(value)} {...rest}>
      {short(value)}
    </span>
  );
}
