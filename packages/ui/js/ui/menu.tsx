import { useEffect, useRef, useState, type ReactNode } from "react";

// A trigger and a floating list. Closes on Escape, on a click outside, and after a pick.
export function Menu({
  trigger,
  label,
  side = "bottom",
  align = "start",
  children,
}: {
  trigger: (props: { open: boolean; toggle: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode;
  label: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      e.preventDefault();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus());
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <span className="menu-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div className={`menu ${side} ${align}`} role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}
