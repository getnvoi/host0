import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./cx";

// Ds::Tile: a thing or a person, its initial on a grey disc or its picture; `current` inks the disc.
export type TileProps = {
  name: string;
  size?: 16 | 20 | 24 | 28 | 32 | 48;
  src?: string;
  current?: boolean;
  off?: boolean;
  decorative?: boolean;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Tile({ name, size = 24, src, current = false, off = false, decorative = false, className, style, ...rest }: TileProps) {
  // Beside the thing's written name the tile only repeats it, so it is hidden from screen readers.
  const named = decorative ? { "aria-hidden": true } : { title: name, "aria-label": name, role: "img" };
  return (
    <span
      className={cx("ds-tile", className, { "is-current": current, "is-off": off })}
      style={{ "--s": `${size}px`, ...style } as CSSProperties}
      {...named}
      {...rest}
    >
      {src ? <img src={src} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
