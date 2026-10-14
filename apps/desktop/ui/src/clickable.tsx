import { createContext, useContext, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { useFloat } from "./floating";

export type ClickableProps = {
  onClick?: () => void;
  // The hover fill; omitted, the surface's (`--click-fill`). "clear" when the content shows its own hover.
  fill?: string;
  radius?: number;
  // How far the fill reaches past the sides, so a row never looks cropped.
  bleed?: number;
  // Keeps the fill shown, as for an open menu.
  active?: boolean;
  disabled?: boolean;
  label?: string;
  // The test handle, `kind:name`.
  handle?: string;
  chosen?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "onClick">;

// False inside a part of a page that takes nothing (an archived record's form): every clickable and input in it is
// disabled.
export const Enabled = createContext(true);

// Anything clickable: the pointing hand, a hover fill and the action. Disabled: no pointer, no hover, no clicks,
// content at half opacity.
export function Clickable({
  onClick, fill, radius = 5, bleed = 0, active, disabled, label, handle, chosen, className, style, children, tabIndex, onKeyDown, ...rest
}: ClickableProps) {
  disabled = disabled || !useContext(Enabled);
  const vars = {
    "--fill": fill === "clear" ? "transparent" : fill,
    // A fill that is the content's own does not darken while pressed.
    "--press": fill === "clear" ? "transparent" : undefined,
    "--radius": `${radius}px`,
    "--bleed": `${bleed}px`,
    ...style,
  } as CSSProperties;
  return (
    <div
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-selected={chosen}
      data-testid={handle}
      data-active={active || undefined}
      className={cn("clickable", className)}
      style={vars}
      tabIndex={disabled ? -1 : (tabIndex ?? 0)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        // Enter and Space act like a click, for the clickable itself and not for a field or button inside it.
        if (e.defaultPrevented || disabled || !onClick || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      onClick={(e) => {
        if (disabled) return;
        // Without an action of its own (a Dropdown's face), the click goes on to whatever holds it.
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// What sits behind a dialog, drawer or open menu: a click on it closes what is open. `tint` dims the window. It is fixed
// to the window (the `Window` and the gallery frames contain it), so its tab strip is dimmed with the page under it; the
// active tab, being the page's colour, would otherwise stay bright above a dimmed page.
export function Backdrop({ tint = true, close }: { tint?: boolean; close: () => void }) {
  useFloat();
  return <div aria-label="Close" className={cn("presence-scrim", tint ? "fixed inset-0 bg-scrim" : "absolute inset-0 bg-transparent")} onClick={close} />;
}
