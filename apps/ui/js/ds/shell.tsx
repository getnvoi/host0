import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { cx } from "./cx";

// Ds::Shell: the app frame: the sidebar down the left, the page filling the rest. With `height` the frame is fixed and
// the page scrolls under its head; `height="full"` is the window's height, the app layout's frame.
export type ShellProps = {
  sidebar?: ReactNode;
  height?: number | "full";
  // The window's frame: the page is the document's main landmark, reached by a skip link, and one polite live region
  // speaks what changes in it. Off for frames drawn inside a page, as in the documentation.
  main?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function Shell({ sidebar, height, main = height === "full", className, style, children, ...rest }: ShellProps) {
  const root = useRef<HTMLDivElement>(null);
  const announcer = useRef<HTMLDivElement>(null);
  useAnnouncer(root, announcer, main);
  const size = height === "full" ? "100dvh" : `${height}px`;
  const css = height ? ({ "--height": size, ...style } as CSSProperties) : style;
  return (
    <div ref={root} className={cx("ds-shell", className, { "has-height": height })} style={css} {...rest}>
      {main && (
        <a href="#main" className="ds-shell-skip">
          Skip to content
        </a>
      )}
      {sidebar}
      {children != null &&
        (main ? (
          <main className="ds-shell-main" id="main" tabIndex={-1}>
            {children}
          </main>
        ) : (
          <div className="ds-shell-main">{children}</div>
        ))}
      {main && <div ref={announcer} className="ds-shell-announcer" id="announcer" role="status" aria-live="polite" />}
    </div>
  );
}

// Speaks what changed in the page through the shell's one polite live region. An element with an id and
// data-announce carries the sentence for its current state; when it is replaced or changed and the sentence differs,
// the region says it once, so a run of events in one state is spoken once. What is on screen when the page arrives is
// recorded, not spoken.
function useAnnouncer(root: RefObject<HTMLDivElement | null>, announcer: RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const element = root.current;
    if (!on || !element) return;
    const said = new Map<string, string | undefined>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keyed by id: a stream swaps the element for a new one under the same id.
    const record = (el: HTMLElement) => {
      if (el.id) said.set(el.id, el.dataset.announce);
    };
    // Emptied first and written a moment later, so the same sentence twice in a row is still spoken.
    const say = (text: string) => {
      const region = announcer.current;
      if (!region) return;
      clearTimeout(timer);
      region.textContent = "";
      timer = setTimeout(() => (region.textContent = text), 100);
    };
    const check = (el: HTMLElement) => {
      if (!el.id) return;
      const seen = said.has(el.id);
      const before = said.get(el.id);
      record(el);
      if (seen && el.dataset.announce && el.dataset.announce !== before) say(el.dataset.announce);
    };
    element.querySelectorAll<HTMLElement>("[data-announce]").forEach(record);
    const observer = new MutationObserver((records) => {
      const touched = new Set<HTMLElement>();
      records.forEach((r) => {
        if (r.type === "attributes") touched.add(r.target as HTMLElement);
        r.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("[data-announce]")) touched.add(node);
          node.querySelectorAll<HTMLElement>("[data-announce]").forEach((el) => touched.add(el));
        });
      });
      touched.forEach((el) => el.isConnected && check(el));
    });
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-announce"] });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [root, announcer, on]);
}
