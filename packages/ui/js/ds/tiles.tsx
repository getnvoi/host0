import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { Tile, type TileProps } from "./tile";

// Ds::Tiles: members as tiles overlapping by 6px, then how many in words.
export type TilesProps = {
  names: string[];
  max?: number;
  size?: TileProps["size"];
  label?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Tiles({ names, max = 4, size = 24, label, className, ...rest }: TilesProps) {
  const words = label ?? `${names.length} ${names.length === 1 ? "member" : "members"}`;
  return (
    <span className={cx("ds-tiles", className)} {...rest}>
      <span className="ds-tiles-row">
        {names.slice(0, max).map((name, i) => (
          <Tile key={i} name={name} size={size} />
        ))}
      </span>
      <span className="ds-tiles-count">{words}</span>
    </span>
  );
}
