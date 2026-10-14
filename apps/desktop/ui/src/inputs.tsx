import { useContext, useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { Clickable, Enabled } from "./clickable";
import { cn } from "./cn";
import { Glyph } from "./glyph";
import { ConfirmDialog, Dialog } from "./heads";
import { useNavigate } from "./screens/navigate";
import { paths, type SettingsPage } from "./screens/routes";
import { Dropdown, menu, MenuPanel } from "./menu";
import { alpha, edge, FieldBox, fieldFocus, FieldLine, itemSize, Spinner, TagFace, type ItemSize, type TagKind } from "./primitives";
import { fieldSize, palette, tone as tones, type FieldSize, type Tone } from "./tokens";

export type TextInputProps = {
  placeholder: string;
  // The name the field's test handle is built from; the placeholder when unset.
  handle?: string;
  value: string;
  onChange?: (value: string) => void;
  mono?: boolean;
  error?: boolean;
  rows?: number;
  glyph?: string;
  size?: FieldSize;
  // Masks what is typed (tokens, passwords).
  secure?: boolean;
  // Shows a value that can be selected and copied.
  readOnly?: boolean;
  // The size of the rows below: the glyph takes their lead column, so the text starts on theirs.
  entries?: ItemSize;
  disabled?: boolean;
  // Waiting for an answer to what is typed: a spinner on the right.
  loading?: boolean;
  // Typed text can be cleared: a round X on the right, while not loading. A search field (the search glyph) has it
  // without asking: its X empties the field, which empties the search.
  onClear?: () => void;
  // Drawn focused, for the gallery.
  focus?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  // What the keyboard and the browser offer for the value (numeric, email, url).
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  type?: InputHTMLAttributes<HTMLInputElement>["type"];
  className?: string;
};

// A text field on the grey area; focused, it turns white with a soft ink ring (fieldFocus).
export function TextInput({
  placeholder, handle, value, onChange, mono, error, rows = 1, glyph, size = "medium", secure, readOnly, entries, disabled, loading, onClear, focus, autoFocus,
  onSubmit, inputMode, type = "text", className,
}: TextInputProps) {
  disabled = disabled || !useContext(Enabled);
  const line = useContext(FieldLine);
  const invalid = error || line?.invalid;
  const [focusedState, setFocused] = useState(false);
  const focused = focus || focusedState;
  const area = useRef<HTMLTextAreaElement>(null);
  const many = rows > 1;
  const pad = size === "medium" ? 12 : 10;
  const lead = entries ? itemSize[entries] : undefined;
  const clear = onClear ?? (glyph === "search" && onChange ? () => onChange("") : undefined);

  // A field of several rows grows with its text, up to twelve rows.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 12 * 22)}px`;
  }, [value, many]);

  const text = cn("min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-tertiary", mono ? "font-mono text-[13px]" : "text-[14px]");
  const common = {
    "aria-label": placeholder,
    "aria-invalid": invalid || undefined,
    "aria-describedby": line?.id,
    "data-testid": `input:${handle ?? placeholder}`,
    placeholder,
    disabled,
    autoFocus,
    inputMode,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 rounded-control transition-colors duration-[120ms]",
        many ? "items-start py-2.5" : "items-center",
        error ? "bg-red-fill" : "bg-page",
        !error && "shadow-[inset_0_0_0_1px_var(--color-field)] hovering:shadow-[inset_0_0_0_1px_var(--color-field-hover)]",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      style={{
        gap: lead?.gap ?? 8,
        paddingLeft: glyph && entries ? 0 : pad,
        paddingRight: pad,
        minHeight: many ? rows * 22 + 20 : fieldSize[size].height,
        ...(error ? edge(alpha(tones.red.ink, 0.5)) : {}),
      }}
      onClick={(e) => (e.currentTarget.querySelector("input, textarea") as HTMLElement | null)?.focus()}
    >
      {glyph && (
        <span className="flex shrink-0 justify-center" style={{ width: lead?.lead }}>
          <Glyph name={glyph} size={13} color={palette.tertiary} />
        </span>
      )}
      {readOnly ? (
        <span className={cn(text, "select-text", many ? "whitespace-pre-wrap" : "truncate", !value && "text-tertiary")}>{value || placeholder}</span>
      ) : many ? (
        <textarea
          ref={area}
          {...common}
          rows={rows}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className={cn(text, "resize-none p-0 leading-[22px]")}
        />
      ) : (
        <input
          {...common}
          type={secure ? "password" : type}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
          className={text}
        />
      )}
      {loading ? (
        <Spinner size={14} />
      ) : (
        clear && value && (
          <Clickable fill={palette.pressed} radius={999} onClick={clear} label="Clear" handle={`button:Clear ${placeholder}`} className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-area">
            <Glyph name="close" size={10} color={palette.secondary} width={2} />
          </Clickable>
        )
      )}
      <span
        className="pointer-events-none absolute -inset-[0.75px] rounded-control transition-opacity duration-[120ms]"
        style={{ boxShadow: fieldFocus, opacity: focused ? 1 : 0 }}
      />
    </div>
  );
}

export type SelectInputProps = {
  options: string[];
  selection: string;
  onChange?: (value: string) => void;
  glyph?: string;
  size?: FieldSize;
  // Defaults to on past six options.
  search?: boolean;
  // Choose in a dialog of this title instead of a menu under the field: for long lists.
  dialog?: string;
  // The line under the dialog's title.
  subtitle?: string;
  // The dialog open from the start, for the gallery.
  open?: boolean;
  // The options are records managed elsewhere (workflows, agents): the menu ends on a way to manage them, and with none
  // it is an invitation to make the first.
  // `page`: the settings page that manages them, opened in its own tab.
  manage?: { noun: string; glyph: string; page: SettingsPage };
  // Every select with a value has an X that clears it, after a question; "none" is never an option. Without this the
  // clear calls `onChange("")` and asks "Clear the choice?". `noun` and `message` word the question; `now` skips it (a
  // filter); `run` clears in a way `onChange("")` cannot say.
  clear?: { noun?: string; message?: string; now?: boolean; run?: () => void };
  disabled?: boolean;
  className?: string;
  // Shown dimmed while nothing is chosen ("Choose an agent"): every select says so, because any select can be empty.
  placeholder: string;
};

// A select: the field's box with a chevron; it opens a menu of the options.
// What a select's dialog says under its title unless told otherwise.
const selectSubtitle = "Select in the list";

export function SelectInput({ options, selection, onChange, glyph, size = "medium", search, dialog, subtitle = selectSubtitle, open, manage, clear, disabled, className, placeholder }: SelectInputProps) {
  disabled = disabled || !useContext(Enabled);
  const line = useContext(FieldLine);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(!!open);
  const [clearing, setClearing] = useState(false);
  const none = !options.includes(selection);
  const noun = clear?.noun ?? "choice";
  // The placeholder stands in for a selection that is empty or that is none of the options.
  const blank = selection === "" || none;
  const empty = () => (clear?.run ? clear.run() : onChange?.(""));
  return (
    <div
      aria-label={selection}
      aria-disabled={disabled || undefined}
      aria-invalid={line?.invalid || undefined}
      aria-describedby={line?.id}
      data-testid={`select:${selection}`}
      className={cn("relative flex w-full min-w-0", disabled && "pointer-events-none opacity-50", className)}
    >
      {dialog ? (
        <>
          <Clickable fill="clear" active={asking} onClick={() => setAsking(true)} className="flex min-w-0 flex-1">
            <SelectFace value={blank ? placeholder : selection} placeholder={blank} glyph={glyph} size={size} />
          </Clickable>
          {asking && (
            // Over the whole window (the window contains fixed layers), as any dialog; the choice closes it.
            <div className="fixed inset-0 z-50">
              <SelectDialog title={dialog} subtitle={subtitle} glyph={glyph ?? "bullets"} options={options} selection={selection} onChange={onChange} search={search ?? true} close={() => setAsking(false)} />
            </div>
          )}
        </>
      ) : (
        <Dropdown
          entries={
            manage && options.length === 0
              ? [menu.empty(manage.glyph, `No ${manage.noun} yet`, `Manage ${manage.noun}`, () => navigate(paths.settings(manage.page), "tab"))]
              : [
                  ...options.map((o) => menu.item(o, { checked: o === selection, radio: true, action: () => onChange?.(o) })),
                  ...(manage ? [menu.divider, menu.item(`Manage ${manage.noun}`, { glyph: manage.glyph, action: () => navigate(paths.settings(manage.page), "tab") })] : []),
                ]
          }
          match
          search={search ?? options.length > 6}
          fill="clear"
          className="flex min-w-0 flex-1"
          label={() => <SelectFace value={blank ? placeholder : selection} placeholder={blank} glyph={glyph} size={size} />}
        />
      )}
      {!blank && !disabled && (
        // The way to empty the field, over its right end, before the chevron.
        <span className="absolute top-1/2 right-9 -translate-y-1/2">
          <Clickable fill={palette.pressed} radius={999} onClick={() => (clear?.now ? empty() : setClearing(true))} label={`Clear the ${noun}`} handle={`button:Clear the ${noun}`} className="inline-flex size-[18px] items-center justify-center rounded-full bg-area">
            <Glyph name="close" size={10} color={palette.secondary} width={2} />
          </Clickable>
        </span>
      )}
      {clearing && (
        <div className="fixed inset-0 z-50">
          <ConfirmDialog
            title={`Clear the ${noun}?`}
            message={clear?.message ?? "The field goes back to empty."}
            action="Clear"
            glyph="close"
            destructive={false}
            confirm={() => {
              empty();
              setClearing(false);
            }}
            cancel={() => setClearing(false)}
          />
        </div>
      )}
    </div>
  );
}

// The choice in a dialog: the search stays under the header, the options run edge to edge and scroll under it, and the
// current one is brought into view.
function SelectDialog({
  title, subtitle, glyph, options, selection, onChange, search, close,
}: { title: string; subtitle: string; glyph: string; options: string[]; selection: string; onChange?: (value: string) => void; search: boolean; close: () => void }) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const pick = (o: string) => {
    onChange?.(o);
    close();
  };
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <Dialog
      title={title}
      line={{ sub: subtitle }}
      glyph={glyph}
      close={close}
      inset="rows"
      strips={search ? <TextInput placeholder="Search" value={query} onChange={setQuery} glyph="search" size="small" autoFocus onSubmit={() => shown[0] && pick(shown[0])} /> : undefined}
      footer={false}
    >
      <div ref={list}>
        {shown.length === 0 ? (
          <span className="flex h-[34px] items-center px-5 text-[13px] text-tertiary">No match</span>
        ) : (
          <MenuPanel flush close={close} entries={shown.map((o) => menu.item(o, { checked: o === selection, radio: true, action: () => onChange?.(o) }))} />
        )}
      </div>
    </Dialog>
  );
}

// A select's box, a step darker while hovered.
export function SelectFace({ value, glyph, size = "medium", placeholder }: { value: string; glyph?: string; size?: FieldSize; placeholder?: boolean }) {
  return <FieldBox value={value} placeholder={placeholder} select glyph={glyph} size={size} />;
}

export type MenuTagProps = {
  options: string[];
  selection: string;
  onChange?: (value: string) => void;
  kind?: TagKind;
  glyph?: string;
  mono?: boolean;
  tone?: Tone;
};

// A badge that opens a menu of values: a role, an access level, the agent or repository in the composer.
export function MenuTag({ options, selection, onChange, kind = "neutral", glyph, mono, tone }: MenuTagProps) {
  return (
    <span aria-label={selection} data-testid={`menutag:${selection}`} className="inline-flex shrink-0">
      <Dropdown
        entries={options.map((o) => menu.item(o, { checked: o === selection, radio: true, action: () => onChange?.(o) }))}
        fill="clear"
        label={() => <TagFace text={selection} kind={kind} glyph={glyph} mono={mono} tone={tone} menu live />}
      />
    </span>
  );
}

// A value on a range, with its name above and the value on the right. `spectrum` draws the track as the hues.
export function Slider({
  label, value, min, max, step = 1, onChange, spectrum, display, disabled,
}: { label: string; value: number; min: number; max: number; step?: number; onChange?: (value: number) => void; spectrum?: boolean; display?: string; disabled?: boolean }) {
  disabled = disabled || !useContext(Enabled);
  const [held, setHeld] = useState(false);
  const position = ((value - min) / (max - min)) * 100;
  return (
    <div data-testid={`slider:${label}`} className="flex flex-col items-stretch gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <span className="font-mono text-[12.5px] text-tertiary tabular-nums">{display ?? value}</span>
      </div>
      <div className="relative">
        {/* The value over the thumb while it is held, so the finger does not hide it. The thumb travels the track less its own width. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-5 -translate-x-1/2 rounded-control bg-ink px-2 py-0.5 font-mono text-[12px] font-medium text-on-solid tabular-nums transition-opacity duration-[120ms]",
            held && !disabled ? "opacity-100" : "opacity-0",
          )}
          style={{ left: `calc(8px + (100% - 16px) * ${position / 100})` }}
        >
          {display ?? value}
        </span>
        <input
          type="range"
          aria-label={label}
          className={cn("slider", spectrum && "slider-spectrum")}
          style={{ "--pos": `${position}%` } as CSSProperties}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(Number(e.target.value))}
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onBlur={() => setHeld(false)}
        />
      </div>
    </div>
  );
}
