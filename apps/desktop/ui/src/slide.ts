import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { byKeyboard } from "./gesture";

// How long the indicator of tabs takes to reach the chosen one, and its curve (transitions.dev, tabs sliding).
const slideDuration = 250;
const slideEase = "cubic-bezier(0.22, 1, 0.36, 1)";

// The place of the chosen child of `track` (its `index`-th element child), for one indicator that slides there.
// It is measured before the first paint, so a page that mounts with the tabs (a route change) draws it in place with
// no movement; only a later change of the choice slides it. A choice made with a key (the arrows) and a resize move it
// at once.
export function useSlide(track: RefObject<HTMLElement | null>, index: number): CSSProperties {
  const [box, setBox] = useState<{ left: number; width: number }>();
  const placed = useRef(false);
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const child = el.children[index] as HTMLElement | undefined;
      if (child) setBox({ left: child.offsetLeft, width: child.offsetWidth });
    };
    setMoving(placed.current && !byKeyboard());
    measure();
    placed.current = true;
    // An observer reports once as it starts; only a later report is a resize. Taken as one, that first report would
    // stop the slide just begun.
    let started = false;
    const watch = new ResizeObserver(() => {
      if (!started) {
        started = true;
        return;
      }
      setMoving(false);
      measure();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [track, index]);
  if (!box) return { visibility: "hidden" };
  return {
    transform: `translateX(${box.left}px)`,
    width: box.width,
    transition: moving ? `transform ${slideDuration}ms ${slideEase}, width ${slideDuration}ms ${slideEase}` : "none",
  };
}

export const slideText = `color ${slideDuration}ms ${slideEase}`;
