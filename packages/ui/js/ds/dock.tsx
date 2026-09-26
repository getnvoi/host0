import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { Button } from "./button";
import { cx } from "./cx";

// Ds::Dock: what stays at the foot of a column page while the page scrolls above it: in a session, the gate stack
// and the composer. With `follow` the page keeps to the newest line while the reader is at the bottom; scrolled up it
// stops following, and a round arrow brings them back down.
export type DockProps = { follow?: boolean } & HTMLAttributes<HTMLDivElement>;

export function Dock({ follow = false, className, children, ...rest }: DockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(true);
  const jumpRef = useRef<() => void>(() => {});

  useEffect(() => {
    const dock = ref.current;
    if (!follow || !dock) return;
    const box = scroller(dock);
    const events: Window | Element = box === document.scrollingElement ? window : box;
    let stuck = false;
    let moving = false;
    let frame = 0;
    const pinned = () => box.scrollHeight - box.clientHeight - box.scrollTop < 40;
    const mark = () => setHidden(pinned());
    // Reads the height once, then writes: at the bottom the arrow is hidden without measuring again.
    const bottom = () => {
      stuck = true;
      moving = true;
      box.scrollTop = box.scrollHeight;
      requestAnimationFrame(() => requestAnimationFrame(() => (moving = false)));
      setHidden(true);
    };
    // The arrow glides, 150ms, so the reader sees where they went; under reduced motion it snaps.
    const jump = () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return bottom();
      const from = box.scrollTop;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 150);
        const to = box.scrollHeight - box.clientHeight;
        box.scrollTop = from + (to - from) * (1 - (1 - t) ** 3);
        if (t < 1) requestAnimationFrame(step);
        else bottom();
      };
      requestAnimationFrame(step);
    };
    jumpRef.current = jump;
    // Whether the reader is at the bottom is decided when they scroll, not after new lines pushed the bottom away.
    const onScroll = () => {
      if (!moving) stuck = pinned();
      mark();
    };
    // A streaming turn mutates in bursts; one frame answers them all, after the browser has laid them out.
    const schedule = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (stuck || moving) bottom();
        else mark();
      });
    };
    events.addEventListener("scroll", onScroll, { passive: true });
    // Sending from the dock (the composer) is reading the newest line: back to the bottom, and follow.
    dock.addEventListener("submit", jump);
    const observer = new MutationObserver(schedule);
    const lines = box === document.scrollingElement ? dock.parentElement! : box;
    observer.observe(lines, { childList: true, subtree: true, characterData: true });
    const sizer = new ResizeObserver(schedule);
    sizer.observe(dock);
    bottom();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizer.disconnect();
      events.removeEventListener("scroll", onScroll);
      dock.removeEventListener("submit", jump);
    };
  }, [follow]);

  return (
    <div ref={ref} className={cx("ds-dock", className)} {...rest}>
      {follow && (
        <span className="ds-dock-jump" hidden={hidden}>
          <Button glyph="arrow-down" label="Scroll to the newest line" onClick={() => jumpRef.current()} />
        </span>
      )}
      {children}
    </div>
  );
}

// The page's scroll area (the dock in its foot), or the nearest scrolling ancestor.
function scroller(dock: HTMLElement): Element {
  const area = dock.closest(".ds-page")?.querySelector(":scope > .ds-page-scroll");
  if (area && !area.contains(dock)) return area;
  for (let node = dock.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return document.scrollingElement ?? document.documentElement;
}
