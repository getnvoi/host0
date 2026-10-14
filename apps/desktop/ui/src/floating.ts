// What floats over the window (scrims, menus, toasts) says so while it shows. Native views drawn above the page,
// such as a browser tab's website, hide while anything floats, since HTML cannot cover them.
import { useEffect, useSyncExternalStore, type RefObject } from "react";

let count = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export const floats = {
  count: () => count,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

// Counts the calling component as floating while it is mounted.
export function useFloat(on = true) {
  useEffect(() => {
    if (!on) return;
    count++;
    changed();
    return () => {
      count--;
      changed();
    };
  }, [on]);
}

// Whether anything floats now.
export function useOverlaid() {
  return useSyncExternalStore(floats.subscribe, () => count > 0);
}

const tabbable = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

// For a dialog or drawer: while mounted, Tab and Shift+Tab stay inside `ref`. The focus moves in when it opens, unless a
// field inside already took it, and goes back to what had it before when it closes.
export function useTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const before = document.activeElement as HTMLElement | null;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    const keep = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const stops = [...root.querySelectorAll<HTMLElement>(tabbable)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (stops.length === 0) {
        e.preventDefault();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const held = document.activeElement;
      if (e.shiftKey && (held === first || held === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && held === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", keep);
    return () => {
      root.removeEventListener("keydown", keep);
      const held = document.activeElement;
      if (before?.isConnected && (!held || held === document.body || root.contains(held))) before.focus({ preventScroll: true });
    };
  }, [ref]);
}
