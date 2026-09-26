import type { HTMLAttributes } from "react";
import { cx } from "./cx";

// Ds::Place: where a thing lives, written small: its owner over its name, as a repository reads in a card or a row.
export type PlaceProps = { name: string; owner?: string } & HTMLAttributes<HTMLSpanElement>;

export function Place({ name, owner, className, ...rest }: PlaceProps) {
  return (
    <span className={cx("ds-place", className)} {...rest}>
      {owner && <span className="ds-place-owner">{owner}</span>}
      <span className="ds-place-name">{name}</span>
    </span>
  );
}
