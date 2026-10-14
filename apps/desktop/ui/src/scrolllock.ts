// While an overlay is open, what scrolls behind it does not. Every scroller that does not sit inside the topmost overlay
// gets `overflow: hidden`, the page area, the transcript, lists, the document; the overlay's own scrollers keep
// scrolling. Overlays are counted: one over another lock once, the scrollers of the lower one lock when the upper one opens,
// and everything is restored when the last one closes. The lock is released at once when an overlay closes, not when its
// exit animation ends (presence.ts): the leaving clone is inert.
import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

type Saved = { overflow: string; paddingRight: string; paddingBottom: string };

// The open overlays, the last one on top, and what is locked.
const stack: HTMLElement[] = [];
const locked = new Map<HTMLElement, Saved>();

function scrolls(el: HTMLElement) {
  if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) return false;
  const css = getComputedStyle(el);
  // The document scrolls the window unless it says otherwise.
  if (el === document.documentElement) return css.overflowY !== "hidden";
  const scrolling = (v: string) => v === "auto" || v === "scroll" || v === "overlay";
  return scrolling(css.overflowX) || scrolling(css.overflowY);
}

function lock(el: HTMLElement) {
  const css = getComputedStyle(el);
  locked.set(el, { overflow: el.style.overflow, paddingRight: el.style.paddingRight, paddingBottom: el.style.paddingBottom });
  // A classic scrollbar takes room that hiding it gives back: the padding keeps the content where it was. Overlay
  // scrollbars (macOS) take none.
  const bars = (el === document.documentElement ? innerWidth - el.clientWidth : el.offsetWidth - el.clientWidth - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth));
  const barBottom = el === document.documentElement ? innerHeight - el.clientHeight : el.offsetHeight - el.clientHeight - parseFloat(css.borderTopWidth) - parseFloat(css.borderBottomWidth);
  el.style.overflow = "hidden";
  if (bars > 0) el.style.paddingRight = `${parseFloat(css.paddingRight) + bars}px`;
  if (barBottom > 0) el.style.paddingBottom = `${parseFloat(css.paddingBottom) + barBottom}px`;
}

function unlock(el: HTMLElement) {
  const saved = locked.get(el);
  if (!saved) return;
  el.style.overflow = saved.overflow;
  el.style.paddingRight = saved.paddingRight;
  el.style.paddingBottom = saved.paddingBottom;
  locked.delete(el);
}

function apply() {
  const top = stack[stack.length - 1];
  if (!top) {
    [...locked.keys()].forEach(unlock);
    return;
  }
  const behind = (el: HTMLElement) => !top.contains(el);
  [...locked.keys()].filter((el) => !behind(el)).forEach(unlock);
  // A locked scroller no longer reads as one, so only the unlocked are tested.
  const found = [...document.querySelectorAll<HTMLElement>("body *"), document.body, document.documentElement].filter((el) => !locked.has(el) && behind(el) && scrolls(el));
  found.forEach(lock);
}

// Whether an open overlay locks what scrolls behind it: on by default; a page that shows overlays as samples (the
// gallery) turns it off, so it keeps scrolling around them.
export const LockScroll = createContext(true);

// Locks what scrolls behind `root` (the overlay's outermost element) while it is mounted, `on`, and LockScroll is on.
export function useScrollLock(root: RefObject<HTMLElement | null>, on = true) {
  const allowed = useContext(LockScroll);
  useLayoutEffect(() => {
    const el = root.current;
    if (!allowed || !on || !el) return;
    stack.push(el);
    apply();
    return () => {
      stack.splice(stack.indexOf(el), 1);
      apply();
    };
  }, [root, on, allowed]);
}
