import { useRef, type ReactNode } from "react";
import { Backdrop } from "../../clickable";
import { useTrap } from "../../floating";
import { useEscape } from "../../menu";
import { usePresence } from "../../presence";
import { alpha } from "../../primitives";
import { useScrollLock } from "../../scrolllock";
import { measure, palette } from "../../tokens";

// The new session over the scrim: its frame at a dialog's width, its top where it stays whatever the step's height, so
// the steps swap in place. It holds the focus, closes on Escape or a press on the scrim, and the page under it does
// not scroll.
export function Floating({ label, close, children }: { label: string; close: () => void; children: ReactNode }) {
  useEscape(close);
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useTrap(panel);
  usePresence(root);
  useScrollLock(root);
  return (
    <div ref={root} className="fixed inset-0 z-40 flex justify-center" style={{ paddingTop: floatingTop, paddingBottom: 32 }}>
      <Backdrop close={close} />
      <div
        ref={panel}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        data-testid={`dialog:${label}`}
        className="relative flex max-h-full min-h-0 flex-col items-stretch gap-3 self-start outline-none presence-panel"
        style={{ width: measure.dialog }}
      >
        {children}
      </div>
    </div>
  );
}

// The floating frame's face: white, its edge, the menu's shadow. Its content fades in again each time `step` changes,
// so a step swaps inside a frame that stays.
export function Frame({ step, children }: { step: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] bg-page" style={{ boxShadow: `inset 0 0 0 1px ${alpha(palette.ink, 0.03)}, var(--shadow-menu)` }}>
      <div key={step} className="flex min-h-0 flex-col" style={{ animation: "presence-fade-in var(--duration-fade) ease-out" }}>
        {children}
      </div>
    </div>
  );
}

// Where the new session's frame starts from the window's top.
const floatingTop = "18vh";
