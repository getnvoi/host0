// How a dialog, drawer or lightbox comes and goes. The page unmounts an overlay the moment it closes, so the panel
// leaves as a clone of itself left in its place (`presence-ghost`, css/presence.css) for the exit time; the overlay itself
// is gone at once, so focus returns, Esc and the scrim act, and the page is live without waiting. An overlay that opens
// while a clone is still leaving takes over from where the clone had got to, so reopening reverses instead of jumping.
// A dialog or lightbox scales from the control that opened it, and a drawer slides from its side; a toast rises and a
// commander only leaves. What a key opened appears at once and only leaves (`data-still`).
import { useLayoutEffect, type RefObject } from "react";
import { byKeyboard, clickedAt } from "./gesture";

// The longest a leaving clone stays if its animation never ends.
const GHOST_LIMIT = 1000;

// What is leaving now: the clone, and the overlay it was cloned from.
let leaving: { clone: HTMLElement; panel: HTMLElement | null; source: HTMLElement } | null = null;

function clearLeaving() {
  leaving?.clone.remove();
  leaving = null;
}

// For a dialog, drawer or lightbox: `root` is its outermost element, holding a `.presence-scrim` and a `.presence-panel`
// (`.presence-drawer` for a drawer).
export function usePresence(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const panel = el.querySelector<HTMLElement>(".presence-panel");
    if (leaving && leaving.source === el) clearLeaving();
    if (panel && !panel.matches(".presence-toast") && byKeyboard()) el.setAttribute("data-still", "");
    else if (panel) {
      if (leaving?.panel) takeOver(panel, leaving.panel);
      else if (!panel.matches(".presence-drawer, .presence-toast, .presence-exit")) growFrom(panel);
    }
    clearLeaving();
    return () => {
      const parent = el.parentNode;
      if (!parent || !panel) return;
      clearLeaving();
      const clone = ghost(el, panel);
      parent.insertBefore(clone, el.nextSibling);
      const done = () => {
        clone.remove();
        if (leaving?.clone === clone) leaving = null;
      };
      const out = clone.querySelector(".presence-panel");
      out?.addEventListener("animationend", done, { once: true });
      out?.addEventListener("animationcancel", done, { once: true });
      setTimeout(done, GHOST_LIMIT);
      leaving = { clone, panel: out as HTMLElement | null, source: el };
    };
  }, [root]);
}

// The panel scales from the centre of the control that opened it, when there is one.
function growFrom(panel: HTMLElement) {
  const opener = clickedAt();
  if (!opener) return;
  // Measured at rest, not at the first frame of its entrance.
  panel.style.animation = "none";
  const r = panel.getBoundingClientRect();
  panel.style.animation = "";
  panel.style.transformOrigin = `${opener.x - r.left}px ${opener.y - r.top}px`;
}

// The new panel's entrance starts where the leaving one had got to.
function takeOver(panel: HTMLElement, from: HTMLElement) {
  const live = getComputedStyle(from);
  const m = new DOMMatrix(live.transform === "none" ? undefined : live.transform);
  panel.style.setProperty("--presence-from-opacity", live.opacity);
  panel.style.setProperty("--presence-from-scale", String(m.a));
  panel.style.setProperty("--presence-from-x", `${m.e}px`);
  panel.style.setProperty("--presence-from-y", `${m.f}px`);
  panel.style.transformOrigin = from.style.transformOrigin;
}

// A still copy of the overlay for its exit: inert, without the names a page or a test finds it by, scrolled and filled
// as the original, its panel leaving from the point its entrance had reached.
function ghost(el: HTMLElement, panel: HTMLElement) {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.classList.add("presence-ghost");
  clone.removeAttribute("data-still");
  clone.setAttribute("inert", "");
  clone.setAttribute("aria-hidden", "true");
  const strip = (node: Element) => ["id", "data-testid", "aria-label", "aria-labelledby", "aria-describedby", "role"].forEach((a) => node.removeAttribute(a));
  const from = [el, ...el.querySelectorAll<HTMLElement>("*")];
  const to = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  from.forEach((node, i) => {
    const copy = to[i];
    strip(copy);
    if (node.scrollTop) copy.scrollTop = node.scrollTop;
    if (node.scrollLeft) copy.scrollLeft = node.scrollLeft;
    if (node instanceof HTMLInputElement && copy instanceof HTMLInputElement) copy.value = node.value;
    if (node instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) copy.value = node.value;
  });
  const out = clone.querySelector<HTMLElement>(".presence-panel");
  if (out) {
    const live = getComputedStyle(panel);
    out.style.setProperty("--presence-live-opacity", live.opacity);
    out.style.setProperty("--presence-live-transform", live.transform);
  }
  return clone;
}
