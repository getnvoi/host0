import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Button } from "./button";
import { cx } from "./cx";

// Ds::Toast: the toast stack, top right: short confirmations that leave on their own after four seconds, or on a
// click. One with an action stays until it is clicked or its action used; Escape closes the one holding focus. The
// layout mounts <Toaster/> once; anything pushes more with toast({ kind, message, action }), which is the window's
// ds:toast event. Kind is a dot, the message is the word.
export type ToastKind = "success" | "error" | "info";
export type ToastAction = { label: string; href?: string };
export type ToastDetail = { kind?: ToastKind; message: string; action?: ToastAction | null };

export function toast(detail: ToastDetail) {
  window.dispatchEvent(new CustomEvent("ds:toast", { detail }));
}

const FLASH: Record<string, ToastKind> = { notice: "success", alert: "error" };

type Item = { id: number; kind: ToastKind; message: string; action?: ToastAction | null; leaving: boolean };
type Clock = { left: number; timer: ReturnType<typeof setTimeout> | null; since: number };

export type ToasterProps = {
  // The request's flash: notice is something that worked, alert something that did not. A value is the message, or
  // { message, action } when the toast offers an action such as Undo.
  flash?: Record<string, string | { message: string; action?: ToastAction }>;
  // More toasts as [kind, message] or [kind, message, action].
  toasts?: [ToastKind, string, ToastAction?][];
  // In the page instead of over it, with no timer: for showing toasts in documentation.
  still?: boolean;
  id?: string;
  duration?: number;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "id" | "children">;

let serial = 0;

export function Toaster({ flash = {}, toasts = [], still = false, id = "toasts", duration = 4000, className, children, ...rest }: ToasterProps) {
  const first = useRef<Item[]>(
    [
      ...Object.entries(flash).map(([type, value]): [ToastKind, string, ToastAction?] =>
        typeof value === "string" ? [FLASH[type] ?? "info", value] : [FLASH[type] ?? "info", value.message, value.action],
      ),
      ...toasts,
    ]
      .filter(([, message]) => message)
      .map(([kind, message, action]) => ({ id: ++serial, kind, message, action, leaving: false })),
  );
  const [items, setItems] = useState<Item[]>(still ? first.current : []);
  const current = useRef(items);
  current.current = items;
  const stack = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const clocks = useRef(new Map<number, Clock>());
  const paused = useRef(false);
  const before = useRef<Map<number, number> | null>(null);

  const update = (next: (items: Item[]) => Item[]) => {
    current.current = next(current.current);
    setItems(current.current);
  };

  // Measure, change, and play each remaining toast from where it was to where it is.
  const glide = (change: () => void) => {
    const tops = new Map<number, number>();
    current.current.forEach((item) => {
      const node = nodes.current.get(item.id);
      if (node && !item.leaving) tops.set(item.id, node.getBoundingClientRect().top);
    });
    before.current = tops;
    change();
  };

  useLayoutEffect(() => {
    const tops = before.current;
    before.current = null;
    if (!tops || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    tops.forEach((top, key) => {
      const node = nodes.current.get(key);
      if (!node?.isConnected) return;
      const by = top - node.getBoundingClientRect().top;
      if (!by) return;
      node.style.transition = "none";
      node.style.transform = `translateY(${by}px)`;
      node.getBoundingClientRect();
      node.style.transition = "";
      node.style.transform = "";
    });
  }, [items]);

  const run = (key: number) => {
    const clock = clocks.current.get(key);
    if (!clock) return;
    clock.since = performance.now();
    clock.timer = setTimeout(() => leave(key), clock.left);
  };

  const stop = (key: number) => {
    const clock = clocks.current.get(key);
    if (!clock?.timer) return;
    clearTimeout(clock.timer);
    clock.timer = null;
    clock.left = Math.max(clock.left - (performance.now() - clock.since), 600);
  };

  // A toast with an action has no clock.
  const arm = (item: Item) => {
    if (still || item.action?.label) return;
    clocks.current.set(item.id, { left: duration, timer: null, since: 0 });
    if (!paused.current && !document.hidden) run(item.id);
  };

  const leave = (key: number) => {
    const item = current.current.find((i) => i.id === key);
    if (!item || item.leaving) return;
    const clock = clocks.current.get(key);
    if (clock?.timer) clearTimeout(clock.timer);
    clocks.current.delete(key);
    update((list) => list.map((i) => (i.id === key ? { ...i, leaving: true } : i)));
    const gone = () => {
      if (current.current.some((i) => i.id === key)) glide(() => update((list) => list.filter((i) => i.id !== key)));
    };
    nodes.current.get(key)?.addEventListener("transitionend", (event) => {
      if (event.propertyName === "opacity") gone();
    });
    setTimeout(gone, 400);
  };

  const add = useCallback(
    (kind: ToastKind = "info", message?: string, action?: ToastAction | null) => {
      if (!message || still) return;
      const item: Item = { id: ++serial, kind, message, action, leaving: false };
      // Top layer order is the order of opening: reopen so a toast sits above a dialog opened before it.
      const el = stack.current;
      if (el?.matches(":popover-open")) {
        el.hidePopover();
        el.showPopover();
      }
      glide(() => update((list) => [item, ...list]));
      arm(item);
      current.current.filter((i) => !i.leaving).slice(4).forEach((i) => leave(i.id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [still, duration],
  );

  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    clocks.current.forEach((_, key) => stop(key));
  };

  // A toast that arrived while the tab was hidden has a clock that never ran: every clock without a timer starts.
  const start = () => {
    if (document.hidden) return;
    paused.current = false;
    clocks.current.forEach((clock, key) => {
      if (!clock.timer) run(key);
    });
  };

  const focused = () => !!stack.current?.contains(document.activeElement);
  const resume = () => {
    if (!focused()) start();
  };

  // The flash is in the page before it is shown, and a live region only speaks what changes after it is in the page:
  // the toasts go in a moment later so they are read.
  useEffect(() => {
    if (still) return;
    stack.current?.showPopover?.();
    const arrival = setTimeout(() => {
      if (!first.current.length) return;
      update((list) => [...list, ...first.current]);
      first.current.forEach(arm);
    }, 150);
    const push = (event: Event) => {
      const { kind, message, action } = (event as CustomEvent<ToastDetail>).detail ?? {};
      add(kind, message, action);
    };
    const visibility = () => {
      if (document.hidden) pause();
      else if (!stack.current?.matches(":hover")) resume();
    };
    window.addEventListener("ds:toast", push);
    document.addEventListener("visibilitychange", visibility);
    const all = clocks.current;
    return () => {
      clearTimeout(arrival);
      window.removeEventListener("ds:toast", push);
      document.removeEventListener("visibilitychange", visibility);
      all.forEach((clock) => clock.timer && clearTimeout(clock.timer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, add]);

  const dismiss = (key: number) => {
    if (!still) leave(key);
  };

  return (
    <div className={cx("ds-toast", className)} {...rest}>
      {children}
      <div
        ref={stack}
        id={id}
        className={cx("ds-toast-stack", { "is-still": still })}
        popover={still ? undefined : "manual"}
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            ref={(node) => {
              if (node) nodes.current.set(item.id, node);
              else nodes.current.delete(item.id);
            }}
            className={cx("ds-toast-item", `is-${item.kind}`, { "is-leaving": item.leaving })}
            role={item.kind === "error" ? "alert" : "status"}
            onClick={() => dismiss(item.id)}
            onKeyDown={(event) => event.key === "Escape" && dismiss(item.id)}
            onPointerEnter={pause}
            onPointerLeave={resume}
            onFocus={pause}
            // Focus leaving for another toast, or with the pointer still on one, keeps the clocks stopped.
            onBlur={(event) => {
              if (!stack.current?.contains(event.relatedTarget as Node | null) && !stack.current?.matches(":hover")) start();
            }}
          >
            <span className="ds-toast-dot" aria-hidden />
            <span className="ds-toast-text">{item.message}</span>
            {item.action?.label && (
              <Button variant="ghost" size="sm" href={item.action.href || "#"}>
                {item.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
