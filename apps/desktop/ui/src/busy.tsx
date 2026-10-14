import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// How long work runs before its busy indicator appears, in ms. A faster answer shows nothing (Doherty threshold).
export const BUSY_DELAY = 150;
// How long an indicator that appeared stays, in ms, so it never blinks.
export const BUSY_MINIMUM = 300;

// Gallery only: shows every busy indicator at once, with no delay, so a capture sees it.
const BusyForced = createContext(false);

export function ShowBusy({ forced = true, children }: { forced?: boolean; children: ReactNode }) {
  return <BusyForced.Provider value={forced}>{children}</BusyForced.Provider>;
}

// Whether a loaded value is a failure (`{ failed }`), which a busy indicator never holds back.
export const hasFailed = (value: unknown): boolean => typeof value === "object" && value !== null && "failed" in value;

// Whether a busy indicator is to be drawn: after BUSY_DELAY of `busy`, then for at least BUSY_MINIMUM.
// The space an indicator takes is kept by its owner, so nothing jumps when it appears.
// `failed`: the work ended in an error, which shows at once and is never held.
export function useDelayedBusy(busy: boolean, failed = false): boolean {
  const forced = useContext(BusyForced);
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (forced) return;
    if (busy && !shown) {
      const timer = setTimeout(() => {
        since.current = performance.now();
        setShown(true);
      }, BUSY_DELAY);
      return () => clearTimeout(timer);
    }
    if (!busy && shown) {
      const timer = setTimeout(() => setShown(false), failed ? 0 : Math.max(0, BUSY_MINIMUM - (performance.now() - since.current)));
      return () => clearTimeout(timer);
    }
  }, [busy, shown, forced, failed]);
  return forced ? busy : shown;
}

// A body that shows `fallback` while `busy`, and keeps showing it until its minimum is over if it had appeared:
// the answer arrives, the indicator does not blink out. Nothing shows before the delay: the space stays empty.
export function Busy({ busy, failed, fallback, children }: { busy: boolean; failed?: boolean; fallback: ReactNode; children: ReactNode }) {
  const shown = useDelayedBusy(busy, failed);
  // Content that replaces a fallback once drawn fades in (`.reveal`); content that came fast enough shows at once.
  const fell = useRef(false);
  if (busy || shown) {
    if (shown) fell.current = true;
    return <>{fallback}</>;
  }
  if (!fell.current) return <>{children}</>;
  return <div className="reveal flex w-full flex-col">{children}</div>;
}
