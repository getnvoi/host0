// The last press of the pointer or a key, noted on the window before whatever it asks for renders. An overlay grows from
// the control that was clicked, and what a key opened or chose appears at once, without motion.

// How long a press still counts as what opened or chose something (an overlay that opens after a request has no
// origin). A workspace could tune it (issue #33).
const OPENER_WINDOW = 1500;

type Press = { at: number; keyed: boolean; x?: number; y?: number };

let last: Press | null = null;
const controls = 'button, [role="button"], [role="menuitem"], [role="tab"], a[href]';

if (typeof document !== "undefined") {
  addEventListener(
    "click",
    (e) => {
      // A click the keyboard caused (Enter on a button) has no pointer and keeps the key's press.
      if (e.detail === 0 && last?.keyed) return;
      const control = e.target instanceof Element ? e.target.closest(controls) : null;
      const r = control?.getBoundingClientRect();
      last = { at: performance.now(), keyed: false, x: r && r.left + r.width / 2, y: r && r.top + r.height / 2 };
    },
    true,
  );
  addEventListener("keydown", () => (last = { at: performance.now(), keyed: true }), true);
}

function recent() {
  return last && performance.now() - last.at <= OPENER_WINDOW ? last : null;
}

// True when the latest press was a key: what it opened or chose shows at once.
export function byKeyboard() {
  return !!recent()?.keyed;
}

// The centre of the control last clicked, if it was clicked just now.
export function clickedAt() {
  const press = recent();
  return press && !press.keyed && press.x !== undefined && press.y !== undefined ? { x: press.x, y: press.y } : null;
}
