import { useSyncExternalStore } from "react";
import { defaultTheme, modes, setDark, switchingTheme, themeRange, type Theme } from "@h0/ui";

// The theme, kept in the webview's local storage: the two variables the greys are built from, and dark mode as a class
// on the document root (the system's preference when the mode is system).
const saved = "h0.theme";
const listeners = new Set<() => void>();

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

function read(): Theme {
  try {
    const raw = localStorage.getItem(saved);
    if (raw) {
      const t = JSON.parse(raw) as Partial<Theme>;
      if (typeof t.hue === "number" && typeof t.tint === "number") {
        return {
          hue: clamp(t.hue, themeRange.hue.min, themeRange.hue.max),
          tint: clamp(t.tint, themeRange.tint.min, themeRange.tint.max),
          mode: modes.find((m) => m === t.mode) ?? defaultTheme.mode,
        };
      }
    }
  } catch {
    // An unreadable saved theme falls back to the default.
  }
  return defaultTheme;
}

let current = read();

const system = matchMedia("(prefers-color-scheme: dark)");

function apply(theme: Theme) {
  switchingTheme();
  setDark(theme.mode === "system" ? system.matches : theme.mode === "dark");
  const style = document.documentElement.style;
  style.setProperty("--hue", String(theme.hue));
  style.setProperty("--tint", String(theme.tint));
}

export const themeStore = {
  get: () => current,
  // Applied at launch, before the first render, so the window never shows the default first.
  start() {
    apply(current);
    system.addEventListener("change", () => apply(current));
  },
  set(theme: Theme) {
    current = theme;
    apply(theme);
    try {
      localStorage.setItem(saved, JSON.stringify(theme));
    } catch {
      // Kept when storage allows it.
    }
    listeners.forEach((l) => l());
  },
  reset() {
    themeStore.set(defaultTheme);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useTheme(): Theme {
  return useSyncExternalStore(themeStore.subscribe, themeStore.get);
}
