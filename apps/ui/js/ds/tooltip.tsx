import { useEffect, useId, useMemo, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

// Shared by every tooltip on the page: the one showing, and until when the next one may skip the delay.
let showing: { hide: () => void } | null = null;
let warmUntil = 0;
const DELAY = 500;
const GRACE = 400;

type Side = "top" | "bottom" | "left" | "right";

// The first tooltip waits and fades in; while one is showing, or just after, the next appears at once with no
// animation. Keyboard focus shows it at once. A press hides it until the pointer leaves.
function useTip(side: Side) {
  const root = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const sideRef = useRef(side);
  sideRef.current = side;

  const tipper = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pressed = false;
    const control = () => {
      const first = root.current?.firstElementChild as HTMLElement | null;
      return first === tip.current ? null : first;
    };
    const isOpen = () => !!tip.current?.matches(":popover-open");

    // 6px off the control on its side, flipped when the window has no room, and kept 8px inside it. The scale
    // grows from the point nearest the control.
    const place = () => {
      const el = tip.current!;
      const box = (control() || root.current!).getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const gap = 6;
      const edge = 8;
      let at: Side = sideRef.current || "top";
      if (at === "top" && box.top - gap - height < edge) at = "bottom";
      else if (at === "bottom" && box.bottom + gap + height > innerHeight - edge) at = "top";
      else if (at === "left" && box.left - gap - width < edge) at = "right";
      else if (at === "right" && box.right + gap + width > innerWidth - edge) at = "left";
      const vertical = at === "top" || at === "bottom";
      let x = vertical ? box.left + box.width / 2 - width / 2 : at === "left" ? box.left - gap - width : box.right + gap;
      let y = vertical ? (at === "top" ? box.top - gap - height : box.bottom + gap) : box.top + box.height / 2 - height / 2;
      x = Math.min(Math.max(x, edge), innerWidth - width - edge);
      y = Math.min(Math.max(y, edge), innerHeight - height - edge);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const originX = vertical ? `${box.left + box.width / 2 - x}px` : at === "left" ? "100%" : "0";
      const originY = vertical ? (at === "top" ? "100%" : "0") : `${box.top + box.height / 2 - y}px`;
      el.style.setProperty("--origin", `${originX} ${originY}`);
    };

    const self = {
      show(instant: boolean) {
        if (showing && showing !== self) showing.hide();
        const el = tip.current;
        if (!el) return;
        el.classList.toggle("is-instant", instant);
        if (!isOpen()) el.showPopover();
        place();
        showing = self;
      },
      hide() {
        if (!isOpen()) return;
        tip.current!.hidePopover();
        if (showing === self) showing = null;
        warmUntil = performance.now() + GRACE;
      },
      enter(event: React.PointerEvent) {
        if (event.pointerType === "touch" || pressed) return;
        clearTimeout(timer);
        if (showing || performance.now() < warmUntil) self.show(true);
        else timer = setTimeout(() => self.show(false), DELAY);
      },
      focus(event: React.FocusEvent) {
        if ((event.target as HTMLElement).matches(":focus-visible")) self.show(true);
      },
      leave() {
        clearTimeout(timer);
        pressed = false;
        self.hide();
      },
      press() {
        clearTimeout(timer);
        pressed = true;
        self.hide();
      },
      key(event: React.KeyboardEvent) {
        if (event.key === "Escape") self.leave();
      },
      // The tip describes the control unless it only repeats the control's name.
      connect() {
        const el = tip.current!;
        const found = control();
        const name = found?.getAttribute("aria-label")?.trim();
        if (found && name !== el.firstChild?.textContent?.trim()) found.setAttribute("aria-describedby", el.id);
        else el.setAttribute("aria-hidden", "true");
      },
      disconnect() {
        clearTimeout(timer);
        if (showing === self) showing = null;
      },
    };
    return self;
  }, []);

  useEffect(() => {
    tipper.connect();
    return () => tipper.disconnect();
  }, [tipper]);

  return { root, tip, tipper };
}

// Ds::Tooltip: a name for something without a label, most often a glyph-only button, shown after a pause.
export type TooltipProps = {
  text: ReactNode;
  side?: Side;
  keys?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Tooltip({ text, side = "top", keys, className, children, ...rest }: TooltipProps) {
  const { root, tip, tipper } = useTip(side);
  const id = `ds-tip-${useId().replace(/:/g, "")}`;
  return (
    <span
      ref={root}
      className={cx("ds-tooltip", className)}
      {...rest}
      onPointerEnter={tipper.enter}
      onPointerLeave={tipper.leave}
      onPointerDown={tipper.press}
      onFocus={tipper.focus}
      onBlur={tipper.leave}
      onKeyDown={tipper.key}
    >
      {children}
      <span ref={tip} id={id} className="ds-tooltip-tip" role="tooltip" popover="manual">
        {text}
        {keys && <kbd className="ds-tooltip-keys">{keys}</kbd>}
      </span>
    </span>
  );
}
