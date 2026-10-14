import { useEffect, useState, type ReactNode } from "react";
import { cn } from "./cn";

// How long a closed fold keeps its content at most: the fold's own time (`--duration-enter`, 260) and a frame.
const foldLeaveMs = 300;

// The region a header folds: it grows to its content and shrinks to nothing, fading with it. Closed, its content is
// not rendered and the region is out of reach of the keyboard and of assistive tech. The header (a row, a card's
// counter, a group title) stays the caller's: it holds `open` and turns its chevron.
export function Accordion({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  // The content stays mounted until the fold has finished, so it leaves with the region instead of vanishing.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  // When no transition runs (reduced motion, a hidden page) its end never comes: the content leaves after the fold's
  // time all the same.
  useEffect(() => {
    if (open || !mounted) return;
    const leave = setTimeout(() => setMounted(false), foldLeaveMs);
    return () => clearTimeout(leave);
  }, [open, mounted]);
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className="grid transition-[grid-template-rows] duration-(--duration-enter) ease-(--ease-panel)"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows" && !open) setMounted(false);
      }}
    >
      <div className={cn("min-h-0 overflow-hidden transition-opacity duration-(--duration-fade) ease-out", open ? "opacity-100" : "opacity-0", className)}>
        {mounted && children}
      </div>
    </div>
  );
}
