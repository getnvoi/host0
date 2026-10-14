import { useSyncExternalStore } from "react";

// Dark is the class "dark" on the document root; the tokens remap under it.
const root = () => document.documentElement;

// A change of theme (mode, hue, tint) switches colours at once: the root carries this class for one frame, which turns
// every transition off (css/index.css).
let switching = false;
export function switchingTheme() {
  if (switching) return;
  switching = true;
  const html = root();
  html.classList.add("theme-switching");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      html.classList.remove("theme-switching");
      switching = false;
    }),
  );
}

export function setDark(on: boolean) {
  if (root().classList.contains("dark") !== on) switchingTheme();
  root().classList.toggle("dark", on);
}

function subscribe(listener: () => void) {
  const watch = new MutationObserver(listener);
  watch.observe(root(), { attributes: true, attributeFilter: ["class"] });
  return () => watch.disconnect();
}

// Whether the window is dark now, for what draws outside the tokens (code highlighting).
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, () => root().classList.contains("dark"));
}
