import {
  useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { Link } from "react-router";
import { cx } from "./cx";
import { Glyph } from "./glyph";
import { Tile } from "./tile";

// Ds::Menu: a floating square list of actions or choices, opened from a trigger. Rows are objects; a menu with `name`
// is a select whose hidden input carries the picked value. Pages get their category icon, actions a glyph.
const WORDS = { ok: "Done", busy: "Running", bad: "Failed" } as const;

// A row: label, and one of href, value (a select pick), toggle (a field name, with checked) or nothing (a plain
// action, its onClick in attrs); plus icon, glyph, tile, hint, disabled (true or the reason), danger, mono, state
// (ok, busy or bad, a dot and a word), word, current (the one in view, checked), attrs.
export type MenuRow = {
  label: string;
  href?: string;
  value?: string | number;
  toggle?: string;
  checked?: boolean;
  icon?: string;
  glyph?: string;
  tile?: string;
  hint?: ReactNode;
  disabled?: boolean | string;
  danger?: boolean;
  mono?: boolean;
  state?: keyof typeof WORDS;
  word?: string;
  current?: boolean;
  attrs?: HTMLAttributes<HTMLElement>;
};
export type MenuGroup = { group: string; items: (MenuRow | null | undefined | false)[] };
export type MenuItem = MenuRow | MenuGroup | "separator" | null | undefined | false;

export type MenuProps = {
  items: MenuItem[];
  name?: string;
  value?: string | number;
  placeholder?: string;
  label?: string;
  search?: boolean | string;
  align?: "start" | "end";
  side?: "bottom" | "top";
  submit?: boolean;
  // The panel's width in px, for rows with long hints; 236 by default.
  width?: number;
  // The field fills its column, as a form's fields do.
  block?: boolean;
  trigger?: ReactNode;
  header?: ReactNode;
  onPick?: (value: string) => void;
  onFlip?: (name: string, on: boolean) => void;
} & Omit<HTMLAttributes<HTMLDivElement>, "onChange">;

const isGroup = (item: MenuItem): item is MenuGroup => typeof item === "object" && !!item && "group" in item;

// The panel is a manual popover in the top layer, placed from the trigger's box and scaled from its side. From a
// pointer it animates and the panel takes focus; from the keyboard it appears at once with the first (or picked) row
// focused. Rows hold focus while highlighted, so arrows, Enter and typeahead act on it.
export function Menu({
  items, name, value, placeholder = "Choose", label, search = false, align = "start", side = "bottom", submit = false,
  width, block = false, trigger, header, onPick, onFlip, className, style, ...more
}: MenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const panelId = `ds-menu-${useId().replace(/:/g, "")}`;
  const list = items.filter(Boolean) as Exclude<MenuItem, null | undefined | false>[];
  const rows = list.flatMap((item) => (isGroup(item) ? (item.items.filter(Boolean) as MenuRow[]) : [item])).filter((r): r is MenuRow => typeof r === "object");
  const select = !!name;
  const [picked, setPicked] = useState(value == null ? undefined : String(value));
  const [toggles, setToggles] = useState(() => Object.fromEntries(rows.filter((r) => r.toggle).map((r) => [r.toggle!, !!r.checked])));
  const [none, setNone] = useState(true);
  const fieldLabel = rows.find((r) => r.value != null && String(r.value) === picked)?.label ?? placeholder;

  const button = () => triggerRef.current?.querySelector<HTMLElement>("button, a, [tabindex]") ?? null;
  const isOpen = () => !!panelRef.current?.matches(":popover-open");
  const visible = () => [...(panelRef.current?.querySelectorAll<HTMLElement>(".ds-menu-row[tabindex]") ?? [])].filter((row) => !row.hidden);

  // Below the trigger, or above when only above fits; aligned to its start or end edge, kept 8px inside the window.
  // --origin puts the scale's anchor on the trigger.
  const place = () => {
    const panel = panelRef.current;
    if (!panel) return;
    const anchor = button() || root.current!;
    const box = anchor.getBoundingClientRect();
    if (!trigger) panel.style.minWidth = `${box.width}px`;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const gap = 4;
    const edge = 8;
    const below = box.bottom + gap + h <= innerHeight - edge;
    const above = box.top - gap - h >= edge;
    const at = side === "top" ? (above || !below ? "top" : "bottom") : below || !above ? "bottom" : "top";
    const startX = align === "end" ? box.right - w : box.left;
    const x = Math.min(Math.max(startX, edge), innerWidth - w - edge);
    const y = at === "bottom" ? box.bottom + gap : box.top - gap - h;
    panel.style.left = `${x}px`;
    panel.style.top = `${Math.max(y, edge)}px`;
    const originX = Math.min(Math.max((align === "end" ? box.right : box.left) - x, 0), w);
    panel.style.setProperty("--origin", `${originX}px ${at === "bottom" ? "0" : "100%"}`);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  // The panel follows its trigger through scrolls and resizes only while open.
  const moved = useRef((event: Event) => {
    if (isOpen() && !panelRef.current?.contains(event.target as Node)) placeRef.current();
  });
  const follow = (on: boolean) => {
    const method = on ? "addEventListener" : "removeEventListener";
    window[method]("scroll", moved.current, true);
    window[method]("resize", moved.current);
  };

  const filter = () => {
    const panel = panelRef.current;
    if (!panel || !searchRef.current) return;
    const query = searchRef.current.value.trim().toLowerCase();
    let any = false;
    panel.querySelectorAll<HTMLElement>(".ds-menu-row").forEach((row) => {
      const hit = !query || (row.textContent ?? "").toLowerCase().includes(query);
      row.hidden = !hit;
      any ||= hit;
    });
    panel.querySelectorAll<HTMLElement>(".ds-menu-group").forEach((group) => (group.hidden = !group.querySelector(".ds-menu-row:not([hidden])")));
    panel.querySelectorAll<HTMLElement>(".ds-menu-rule").forEach((rule) => (rule.hidden = !!query));
    setNone(any);
    if (isOpen()) place();
  };

  const open = ({ keyboard = false, last = false } = {}) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.classList.toggle("is-instant", keyboard);
    if (searchRef.current) {
      searchRef.current.value = "";
      filter();
    }
    panel.showPopover();
    follow(true);
    place();
    button()?.setAttribute("aria-expanded", "true");
    if (searchRef.current) return searchRef.current.focus({ preventScroll: true });
    if (!keyboard) return panel.focus({ preventScroll: true });
    const all = visible();
    const chosen = all.find((row) => row.getAttribute("aria-checked") === "true" && row.getAttribute("role") === "menuitemradio");
    (chosen || all[last ? all.length - 1 : 0])?.focus();
  };

  const close = ({ instant = false, restore = true } = {}) => {
    const panel = panelRef.current;
    if (!panel || !isOpen()) return;
    const inside = panel.contains(document.activeElement);
    panel.classList.toggle("is-instant", instant);
    panel.hidePopover();
    follow(false);
    button()?.setAttribute("aria-expanded", "false");
    if (restore && inside) button()?.focus({ preventScroll: true });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const b = button();
    b?.setAttribute("aria-haspopup", "menu");
    b?.setAttribute("aria-expanded", "false");
    b?.setAttribute("aria-controls", panelId);
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (isOpen() && !triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) closeRef.current({ restore: false });
    };
    document.addEventListener("pointerdown", away, true);
    const handler = moved.current;
    const panel = panelRef.current;
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
      if (panel?.matches(":popover-open")) panel.hidePopover();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  // A click from Enter or Space has no pointer detail: that is the keyboard.
  const toggle = (event: ReactMouseEvent) => {
    if ((button() as HTMLButtonElement | null)?.disabled) return;
    if (isOpen()) close({ instant: event.detail === 0 });
    else open({ keyboard: event.detail === 0 });
  };

  const press = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!isOpen()) open({ keyboard: true, last: event.key === "ArrowUp" });
  };

  const step = (by: number) => {
    const all = visible();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at === -1 ? (by > 0 ? 0 : all.length - 1) : (at + by + all.length) % all.length;
    all[next].focus();
  };

  // Letters typed within half a second build a prefix; one letter pressed again cycles through its rows.
  const typeahead = (letter: string) => {
    const t = typed.current;
    t.text += letter;
    clearTimeout(t.timer);
    t.timer = setTimeout(() => (t.text = ""), 500);
    const all = visible();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const repeated = [...t.text].every((c) => c === t.text[0]);
    const query = repeated ? t.text[0] : t.text;
    const from = Math.max(repeated ? at + 1 : at, 0);
    const order = all.slice(from).concat(all.slice(0, from));
    order.find((row) => (row.querySelector(".ds-menu-label")?.textContent ?? "").trim().toLowerCase().startsWith(query))?.focus();
  };

  const key = (event: ReactKeyboardEvent) => {
    const k = event.key;
    const inSearch = !!searchRef.current && event.target === searchRef.current;
    if (k === "ArrowDown" || k === "ArrowUp") {
      event.preventDefault();
      step(k === "ArrowDown" ? 1 : -1);
    } else if ((k === "Home" || k === "End") && !inSearch) {
      event.preventDefault();
      const all = visible();
      all[k === "Home" ? 0 : all.length - 1]?.focus();
    } else if (k === "Escape" || k === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close({ instant: true });
    } else if (k === "Enter" && inSearch) {
      event.preventDefault();
      visible()[0]?.click();
    } else if (!search && k.length === 1 && k !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typeahead(k.toLowerCase());
    }
  };

  const hover = (event: ReactPointerEvent) => {
    const row = (event.target as Element).closest?.<HTMLElement>(".ds-menu-row[tabindex]");
    if (row && document.activeElement !== row) row.focus({ preventScroll: true });
  };

  const rest = () => {
    const panel = panelRef.current;
    if (!panel || !panel.contains(document.activeElement) || !isOpen()) return;
    (searchRef.current ?? panel).focus({ preventScroll: true });
  };

  const requestSubmit = () => root.current?.closest("form")?.requestSubmit();

  const pick = (event: ReactMouseEvent, row: MenuRow) => {
    const v = String(row.value);
    setPicked(v);
    if (valueRef.current) {
      valueRef.current.value = v;
      valueRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close({ instant: event.detail === 0 });
    onPick?.(v);
    if (submit) requestSubmit();
  };

  // A switch row flips and the menu stays open, so the next one is a click away.
  const flip = (row: MenuRow) => {
    const on = !toggles[row.toggle!];
    setToggles((t) => ({ ...t, [row.toggle!]: on }));
    const input = root.current?.querySelector<HTMLInputElement>(`input[type=hidden][name="${CSS.escape(row.toggle!)}"]`);
    // Off is blank, so a GET form drops it and the URL holds only what narrows.
    if (input) input.value = on ? "1" : "";
    onFlip?.(row.toggle!, on);
    if (submit) requestSubmit();
  };

  const role = (row: MenuRow) => (row.toggle ? "menuitemcheckbox" : select && row.value != null ? "menuitemradio" : "menuitem");
  const checked = (row: MenuRow) => (row.toggle ? !!toggles[row.toggle] : String(row.value) === picked);

  const renderRow = (row: MenuRow, index: number) => {
    const inner = (
      <>
        {lead(row)}
        <span className="ds-menu-text">
          <span className="ds-menu-label">{row.label}</span>
          {row.hint && <span className="ds-menu-hint">{row.hint}</span>}
        </span>
        {trail(row)}
      </>
    );
    const classes = cx("ds-menu-row", {
      "is-danger": row.danger, "is-off": row.disabled, "is-mono": row.mono, "is-current": row.current,
    });
    const r = role(row);
    const common = { className: classes, role: r, "aria-current": row.current ? true : undefined };
    if (row.disabled) {
      return (
        <div key={index} {...common} aria-disabled>
          {inner}
        </div>
      );
    }
    const { onClick: extra, ...attrs } = row.attrs ?? {};
    const props = {
      ...common,
      tabIndex: -1,
      "aria-checked": r !== "menuitem" ? String(checked(row)) as "true" | "false" : undefined,
      ...attrs,
      onClick: (event: ReactMouseEvent<HTMLElement>) => {
        if (row.toggle) flip(row);
        else if (row.value != null && !row.href) pick(event, row);
        else close({ instant: event.detail === 0 });
        extra?.(event);
      },
    };
    if (row.href) {
      return /^[a-z]+:/.test(row.href) ? (
        <a key={index} href={row.href} {...props}>
          {inner}
        </a>
      ) : (
        <Link key={index} to={row.href} {...props}>
          {inner}
        </Link>
      );
    }
    return (
      <button key={index} type="button" {...props}>
        {inner}
      </button>
    );
  };

  // The reason a row is off, its switch, or the check of a select.
  const trail = (row: MenuRow) => {
    if (typeof row.disabled === "string") return <span className="ds-menu-reason">{row.disabled}</span>;
    if (row.state || row.current) {
      return (
        <span className="ds-menu-trail">
          {/* The dot and its word: colour alone never carries the state. */}
          {row.state && (
            <>
              <span className={`ds-menu-dot is-${row.state}`} aria-hidden />
              <span className="ds-menu-word">{row.word ?? WORDS[row.state]}</span>
            </>
          )}
          {row.current && (
            <span className="ds-menu-check is-shown" aria-hidden>
              <Glyph name="check" />
            </span>
          )}
        </span>
      );
    }
    if (row.toggle) return <span className="ds-menu-switch" aria-hidden />;
    if (!(select && row.value != null)) return null;
    return (
      <span className="ds-menu-check" aria-hidden>
        <Glyph name="check" />
      </span>
    );
  };

  const css = width ? ({ "--menu-width": `${Math.trunc(width)}px`, ...style } as CSSProperties) : style;
  return (
    <div ref={root} className={cx("ds-menu", className, { "is-block": block })} style={css} {...more}>
      {select && <input ref={valueRef} type="hidden" name={name} value={picked ?? ""} />}
      {rows
        .filter((r) => r.toggle)
        .map((r) => (
          <input key={r.toggle} type="hidden" name={r.toggle} value={toggles[r.toggle!] ? "1" : ""} />
        ))}
      <div ref={triggerRef} className="ds-menu-trigger" onClick={toggle} onKeyDown={press}>
        {trigger ?? (
          <button type="button" className="ds-menu-field" aria-label={label}>
            <span className="ds-menu-field-label">{fieldLabel}</span>
            <Glyph name="chevron-down" />
          </button>
        )}
      </div>
      <div
        ref={panelRef}
        id={panelId}
        className="ds-menu-panel"
        role="menu"
        popover="manual"
        tabIndex={-1}
        onKeyDown={key}
        onPointerMove={hover}
        onPointerLeave={rest}
      >
        {header && <div className="ds-menu-head">{header}</div>}
        {search && (
          <label className="ds-menu-search">
            <Glyph name="search" />
            <input
              ref={searchRef}
              type="search"
              placeholder={typeof search === "string" ? search : "Search"}
              autoComplete="off"
              spellCheck={false}
              aria-label="Search"
              onInput={filter}
            />
          </label>
        )}
        {list.map((item, i) =>
          item === "separator" ? (
            <hr key={i} className="ds-menu-rule" />
          ) : isGroup(item) ? (
            <div key={i} className="ds-menu-group" role="group" aria-label={item.group}>
              <div className="ds-menu-group-label" aria-hidden>
                {item.group}
              </div>
              {(item.items.filter(Boolean) as MenuRow[]).map(renderRow)}
            </div>
          ) : (
            renderRow(item, i)
          ),
        )}
        {search && (
          <div className="ds-menu-none" hidden={none}>
            Nothing matches.
          </div>
        )}
      </div>
    </div>
  );
}

function lead(row: MenuRow) {
  if (row.icon) return <Glyph name={row.icon} size={20} />;
  if (row.tile) return <Tile name={row.tile} size={20} />;
  if (row.glyph)
    return (
      <span className="ds-menu-glyph">
        <Glyph name={row.glyph} />
      </span>
    );
  return null;
}
