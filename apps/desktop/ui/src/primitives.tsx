import { createContext, useContext, useId, useRef, type CSSProperties, type ReactNode , useLayoutEffect } from "react";
import { cn } from "./cn";
import { useDelayedBusy } from "./busy";
import { Clickable, Enabled } from "./clickable";
import { CopyGlyph, Glyph, Turn } from "./glyph";
import { slideText, useSlide } from "./slide";
import { avatarFill, edgeInset, markGap, markSlot, palette, textEdge, toneEdge, tone as tones, type FieldSize, fieldSize, type Tone } from "./tokens";

// A colour at an opacity, for edges ("tinted surfaces take their ink at 8%").
export function alpha(color: string, a: number) {
  return `color-mix(in srgb, ${color} ${a * 100}%, transparent)`;
}

// A 1pt edge drawn inside the box.
export function edge(color: string, width = 1): CSSProperties {
  return { boxShadow: `inset 0 0 0 ${width}px ${color}` };
}

// A focused field: an ink ring, softened so it does not shout, and a pale halo around it.
export const fieldFocus = `inset 0 0 0 1.5px ${alpha(palette.ink, 0.6)}, 0 0 0 4px ${alpha(palette.ink, 0.07)}`;

export function Dot({ tone, size = 6 }: { tone: Tone; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: tones[tone].dot }} />;
}

// A status pill: tinted fill, dot, word. Always last on the right of a row.
export function Pill({ text, tone, dot = true }: { text: string; tone: Tone; dot?: boolean }) {
  const t = tones[tone];
  return (
    <span
      className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-pill px-2 text-[12.5px] font-medium whitespace-nowrap"
      style={{ color: t.ink, background: t.fill, ...edge(alpha(t.ink, toneEdge)) }}
    >
      {dot && <Dot tone={tone} />}
      {text}
    </span>
  );
}

export type TagKind = "neutral" | "inverse";

export type TagProps = {
  text: string;
  kind?: TagKind;
  size?: "medium" | "small";
  glyph?: string;
  mono?: boolean;
  tone?: Tone;
  count?: number;
  menu?: boolean;
  remove?: boolean;
  shrink?: boolean;
  // Drawn hovered, as when the menu holding it is.
  hover?: boolean;
  onClick?: () => void;
};

// A row's leading mark on the page's grid: centred on the mark axis, so the text after it starts on the text edge.
// `from`: where the row's content starts, from the edge of what holds it (a row's hover fill 4 in: 4). `gap`: the row's
// own gap after the mark, taken back. Every leading mark of a row in a card, a note, a strip, a gate or the composer
// goes through it, so they all sit on one vertical and their words on another.
export function RowMark({ from = 0, gap = 0, children }: { from?: number; gap?: number; children: ReactNode }) {
  return (
    <span data-mark className="flex shrink-0 items-center justify-center" style={{ marginLeft: edgeInset - from, width: markSlot, marginRight: markGap - gap }}>
      {children}
    </span>
  );
}

// A thin header in a tone: 28 high, a glyph and its label in mono on the left, a mono detail on the right, a line
// under it in the tone's ink. A gate's head, a note's head. `inset` is where the label starts, `end` the space after the glyph.
// With `mark` and `textAt` (the composer's tray), the glyph is centred in a column `mark` wide from `inset`, as the tray's
// other marks are, and the label starts at `textAt`, where the tray's words start.
export function ToneStrip({ tone, label, glyph, detail, action, fill, style, children }: {
  tone: Tone; label: ReactNode; glyph?: string; detail?: string; action?: ReactNode; fill?: string; style?: CSSProperties; children?: ReactNode;
}) {
  const t = tones[tone];
  // On the page's grid: the glyph on the mark axis, the label on the text edge, the detail ending `edgeInset` in.
  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2"
      style={{ paddingLeft: glyph ? 0 : textEdge, paddingRight: edgeInset, background: fill ?? t.fill, color: t.ink, boxShadow: `inset 0 -1px 0 ${alpha(t.ink, toneEdge)}`, ...style }}
    >
      {glyph && (
        <RowMark gap={8}>
          <Glyph name={glyph} size={13} color={t.ink} />
        </RowMark>
      )}
      {/* A label in mono is uppercase, as every mono label is. */}
      <span className={cn(monoCaps, "min-w-0 truncate font-medium whitespace-nowrap")}>{label}</span>
      {children}
      <span className="min-w-3 flex-1" />
      {detail && <span className="truncate font-mono text-[11.5px]">{detail}</span>}
      {/* An icon button last on the right (a strip that closes what it heads): it ends `edgeInset` in, as a badge does. */}
      {action}
    </div>
  );
}

// The mono voice of a label: 11, uppercase, spaced (a strip's label, a form's overtitle, a gate's key phrase).
export const monoCaps = "font-mono text-[11px] tracking-[0.7px] uppercase";

// A state in a few letters, in its tone: mono 12 on the tone's fill, edged with its ink, 20 high. A call's "running",
// a message's "Queued".
export function Chip({ text, tone }: { text: string; tone: Tone }) {
  const t = tones[tone];
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center truncate rounded-tag px-1.5 font-mono text-[12px] tabular-nums"
      style={{ color: t.ink, background: t.fill, ...edge(alpha(t.ink, toneEdge)) }}
    >
      {text}
    </span>
  );
}

// A badge: a named thing in a small filled box, optionally with a glyph, dot, count, menu or remove. With an action
// it is clickable and a step darker while hovered. On a selected row's grey fill a grey tag turns white.
export function Tag(props: TagProps) {
  if (props.onClick) {
    return (
      <Clickable fill="clear" radius={6} onClick={props.onClick} className={cn("inline-flex", props.shrink ? "min-w-0" : "shrink-0")}>
        <TagFace {...props} live />
      </Clickable>
    );
  }
  return <TagFace {...props} />;
}

const tagFill: Record<TagKind, string> = {
  neutral: "bg-page",
  inverse: "bg-ink",
};

// A tag with an action darkens while its own clickable is hovered; a plain one never does.
const tagFillLive: Record<TagKind, string> = {
  neutral: "hovering:bg-quiet",
  inverse: "",
};

const tagFillHover: Record<TagKind, string> = {
  neutral: "bg-quiet",
  inverse: "bg-ink",
};

export function TagFace({ text, kind = "neutral", size = "medium", glyph, mono, tone, count, menu, remove, shrink, hover, live }: TagProps & { live?: boolean }) {
  const medium = size === "medium";
  const fs = medium ? 13 : 12;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-tag whitespace-nowrap",
        medium ? "h-6 px-2" : "h-5 px-1.5",
        hover ? tagFillHover[kind] : cn(tagFill[kind], live && tagFillLive[kind]),
        kind === "inverse" ? "text-on-solid" : "text-muted",
        shrink ? "min-w-0" : "shrink-0",
      )}
      style={kind === "inverse" ? undefined : edge(palette.line)}
    >
      {glyph && <Glyph name={glyph} size={fs - 1} color={kind === "inverse" ? palette.faint : palette.tertiary} />}
      {tone && <Dot tone={tone} />}
      {/* Raised half a point: the line box centres the font's whole height, which leaves lowercase below its glyphs. */}
      <span className={cn("-translate-y-[0.5px] truncate", mono ? "font-mono" : "font-ui")} style={{ fontSize: mono ? fs - 0.5 : fs }}>
        {text}
      </span>
      {count !== undefined && (
        <span
          className={cn(
            "inline-flex min-h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] tabular-nums",
            kind === "inverse" ? "bg-primary" : "bg-pressed",
          )}
        >
          {count}
        </span>
      )}
      {menu && (
        <Turn menu>
          <Glyph name="chevronDown" size={10} color={palette.tertiary} width={1.6} />
        </Turn>
      )}
      {remove && <Glyph name="close" size={10} color={palette.tertiary} width={1.6} />}
    </span>
  );
}

// Without a fill, the colour is locked by the initials. With `src`, the person's picture fills the circle instead.
export function Avatar({ initials, size = 20, fill, fontSize, src }: { initials: string; size?: number; fill?: string; fontSize?: number; src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={initials}
        className="inline-block shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, ...edge(alpha(palette.ink, 0.03)) }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-secondary"
      style={{
        width: size,
        height: size,
        background: fill ?? avatarFill(initials),
        fontSize: fontSize ?? Math.max(8.5, Math.round(size * 0.34)),
        letterSpacing: 0.2,
        ...edge(alpha(palette.ink, 0.03)),
      }}
    >
      {initials}
    </span>
  );
}

// `detail` is the line under the name in a person card: an email or a role.
export type Person = { initials: string; fill?: string; name?: string; src?: string; detail?: string };

// The tab a tab session acts in: whose it is, and whether their app holds it online.
export type TabStatus = { owner: string; state: "online" | "offline" | "none" };

export const tabStatus = {
  place: (t: TabStatus) => (t.owner ? `Tab · ${t.owner}` : "Tab"),
  pill: (t: TabStatus): { text: string; tone: Tone } =>
    t.state === "online" ? { text: "Tab online", tone: "green" } : t.state === "offline" ? { text: "Tab offline", tone: "grey" } : { text: "No tab", tone: "grey" },
  owned: (t: TabStatus) => (t.owner ? `${t.owner}’s tab` : "The tab"),
};

// `tone`: tinted in that tone (its ink on a wash of it), for a key named on a toned surface (a gate's foot).
export function Kbd({ k, tone }: { k: string; tone?: Tone }) {
  const t = tone ? tones[tone] : undefined;
  return (
    <span
      className={cn("inline-flex min-h-5 min-w-5 items-center justify-center rounded-[4px] px-[5px] font-mono text-[11px]", !t && "bg-page text-secondary")}
      style={t ? { background: alpha(t.ink, 0.07), color: t.ink, ...edge(alpha(t.ink, 0.18)) } : edge(palette.pressed)}
    >
      {k}
    </span>
  );
}

// A keyboard hint: the keys, then what they do, in caption type.
export function KeyHint({ keys, text }: { keys: string[]; text: string }) {
  return (
    // One hint wraps whole to the next line, never inside its words.
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      {keys.map((k, i) => (
        <Kbd key={i} k={k} />
      ))}
      <span className="truncate text-[12.5px] text-tertiary">{text}</span>
    </span>
  );
}

// A count beside a title: a small round badge.
export function Count({ value }: { value: number }) {
  return (
    <span
      className="inline-flex min-h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-area px-1.5 text-[11px] font-medium tabular-nums text-secondary"
      style={edge(alpha(palette.ink, 0.05))}
    >
      {value}
    </span>
  );
}

// A group's title in a list or menu: small uppercase mono, dimmed, with its count.
export function GroupTitle({ title, count, className }: { title: string; count?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="font-mono text-[11px] font-medium tracking-[0.6px] text-tertiary uppercase">{title}</span>
      {count !== undefined && <Count value={count} />}
    </div>
  );
}

// A section's title in a form or drawer.
export function SectionLabel({ text, className }: { text: string; className?: string }) {
  return <GroupTitle title={text} className={className} />;
}

// Work in progress: a turning arc in the colour of what it replaces, solid, both ends round, over the rest of the circle
// at a part of its strength so the circle is whole.
const spinnerTrack = 0.22;
const spinnerArc = 0.28;
export function Spinner({ size = 16, color = palette.tertiary }: { size?: number; color?: string }) {
  const w = Math.max(1.5, size / 9);
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-label="Loading" role="img" width={size} height={size} className="shrink-0 animate-[spin_0.9s_linear_infinite]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={spinnerTrack} strokeWidth={w} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeDasharray={`${c * spinnerArc} ${c}`} />
    </svg>
  );
}

// A block of what is not loaded yet: a grey bar that pulses once a second (`.skeleton`), still under reduced motion. It is round by default;
// `className` sets the size, the shape and `bg-quiet` where it sits on a grey surface.
// It keeps its place from the start but is drawn only after `BUSY_DELAY`, so a fast answer shows no flash.
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  const shown = useDelayedBusy(true);
  return <span aria-hidden className={cn("skeleton block shrink-0 rounded-full bg-line", !shown && "invisible", className)} style={style} />;
}

// A body still loading: the spinner and what it waits for, in the middle of the space.
// The space is kept from the start; the spinner and the line appear after `BUSY_DELAY`.
export function LoadingState({ text = "Loading" }: { text?: string }) {
  const shown = useDelayedBusy(true);
  return (
    <div className={cn("mt-(--state-offset,0px) flex min-h-40 w-full flex-1 flex-col items-center justify-center gap-2.5", !shown && "invisible")}>
      <Spinner size={18} />
      <span className="text-[13px] text-tertiary">{text}</span>
    </div>
  );
}

// `tinted`: a secondary in a colour, its ink on its pale fill (`tone`); red ends a form with its delete.
export type ButtonKind = "primary" | "secondary" | "tinted" | "selected" | "ghost" | "link" | "quiet" | "danger" | "disabled";
export type ButtonSize = "medium" | "small" | "mini";

// Hover fills apply on hover and under the gallery's `.show-hover`.
const buttonFace: Record<ButtonKind, string> = {
  primary: "bg-primary text-on-solid hover:bg-primary/86 [.show-hover_&]:bg-primary/86",
  danger: "bg-red-ink text-on-solid hover:bg-red-ink/88 [.show-hover_&]:bg-red-ink/88",
  secondary: "text-ink",
  tinted: "bg-(--rest) text-(--ink) hover:bg-(--over) [.show-hover_&]:bg-(--over)",
  selected: "bg-pressed text-ink hover:bg-faint/60 [.show-hover_&]:bg-faint/60",
  ghost: "bg-transparent text-secondary hover:bg-area [.show-hover_&]:bg-area",
  disabled: "bg-area text-faint",
  link: "",
  quiet: "",
};

const buttonFaceHover: Record<ButtonKind, string> = {
  primary: "bg-primary/86",
  danger: "bg-red-ink/88",
  secondary: "",
  tinted: "bg-(--over)",
  selected: "bg-faint/60",
  ghost: "bg-area",
  disabled: "",
  link: "",
  quiet: "",
};

// The tone of the surface a control sits on. Buttons there take that tone instead of grey or black.
export const OnTone = createContext<Tone | undefined>(undefined);

// A button's face on a toned surface: the primary a deeper solid of the ink, the rest its ink on white at a part.
const onToneKinds: ButtonKind[] = ["primary", "secondary", "selected", "ghost", "disabled"];

function onToneFace(kind: ButtonKind, t: Tone): { rest: string; over: string; ink: string; edge: string } {
  const { ink, fill } = tones[t];
  // A solid face looks larger than an outlined one of the same size: the solid takes a little of the surface's colour and
  // the outlined one a firmer edge and a fuller fill, so a pair (Allow, Deny) reads as one weight.
  if (kind === "primary") {
    return { rest: `color-mix(in oklab, ${ink} 90%, ${fill})`, over: `color-mix(in oklab, ${ink} 80%, ${palette.page})`, ink: palette.onSolid, edge: `inset 0 1px 0 ${palette.glint}` };
  }
  if (kind === "ghost") return { rest: "transparent", over: alpha(ink, 0.1), ink, edge: "none" };
  if (kind === "disabled") return { rest: alpha(ink, 0.08), over: alpha(ink, 0.08), ink: alpha(ink, 0.45), edge: "none" };
  return { rest: alpha(palette.page, 0.85), over: palette.page, ink, edge: `inset 0 0 0 1.5px ${alpha(ink, 0.45)}` };
}

export type ButtonProps = {
  children: ReactNode;
  kind?: ButtonKind;
  size?: ButtonSize;
  // A secondary button's resting fill on a grey surface; it goes a step lighter on hover.
  fill?: string;
  // A tinted button's colour.
  tone?: Tone;
  loading?: boolean;
  disabled?: boolean;
  // A glyph before the title.
  glyph?: string;
  // A chevron after the title: the button opens a menu (as the label of a `Dropdown`).
  chevron?: boolean;
  // A number before the title, inside the button, in the button's own tone: white on its colour for a solid button,
  // its ink on its soft fill for a soft one (changed files on a pull request button).
  count?: number;
  // A copy button: its copy glyph turns into a check while true.
  copied?: boolean;
  // Drawn hovered, for the gallery.
  hover?: boolean;
  onClick?: () => void;
  className?: string;
  label?: string;
  // The test handle, when it is not the title (a dialog's buttons).
  handle?: string;
  // A ghost button that starts a row on a text edge: its padding reaches out so its text sits on the edge. A ghost
  // button first in a `hang` row (drawer, dialog and onboarding foots) hangs by itself.
  hang?: boolean;
};

// A button's face. Disabled greys it out; loading keeps its width, hides the label under a spinner and takes no
// clicks.
// The most a button's count shows: a larger count reads 99. The count sits inside the button, before its title, on the text's line.
const countMost = 99;

// The count in the button's own tone, with no edge: a little lighter than a solid button's colour, a little darker
// than a soft button's fill, its text the button's own.
function countFace(k: ButtonKind, tone: Tone): CSSProperties {
  if (k === "primary") return { background: "color-mix(in oklab, var(--color-primary) 80%, white)", color: palette.onSolid };
  if (k === "danger") return { background: `color-mix(in oklab, ${tones.red.ink} 80%, white)`, color: palette.onSolid };
  if (k === "tinted") return { background: `color-mix(in oklab, ${tones[tone].fill} 88%, ${tones[tone].ink})`, color: tones[tone].ink };
  return { background: palette.pressed, color: palette.ink };
}

export function Button({ children, kind = "secondary", size = "medium", fill, tone = "grey", loading, disabled, glyph, chevron, count, copied, hover, onClick, className, label, handle: named, hang }: ButtonProps) {
  disabled = disabled || !useContext(Enabled);
  const onTone = useContext(OnTone);
  // The spinner and the hidden label swap after `BUSY_DELAY`; the button ignores clicks from the moment `loading` is true.
  const spinning = useDelayedBusy(!!loading);
  const k: ButtonKind = disabled && !loading ? "disabled" : kind;
  const toned = onTone && onToneKinds.includes(k) ? onToneFace(k, onTone) : undefined;
  const medium = size === "medium";
  const mini = size === "mini";
  const handle = named ?? `button:${label ?? (typeof children === "string" ? children : "")}`;
  // As shadcn's: 14px medium text on a 20px line, a 16px glyph beside it, and a tighter inset on a button that
  // holds one, so the glyph and the title read as centred together.
  const pad = glyph || chevron ? (medium ? 16 : mini ? 8 : 10) : medium ? 24 : mini ? 10 : 12;
  const content = (
    <>
      {glyph && (copied === undefined ? <Glyph name={glyph} size={mini ? 13 : 16} width={1.4} color="currentColor" /> : <CopyGlyph copied={copied} size={mini ? 13 : 16} width={1.4} color="currentColor" />)}
      {count !== undefined && (
        <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-control px-1 text-[11px] font-medium tabular-nums" style={countFace(k, tone)}>
          {Math.min(count, countMost)}
        </span>
      )}
      {/* The title truncates when the button is held narrower than it; the marks around it keep their size. */}
      <span className="min-w-0 truncate">{children}</span>
      {chevron && (
        <Turn menu>
          <Glyph name="chevronDown" size={mini ? 13 : 16} width={1.4} color="currentColor" />
        </Turn>
      )}
    </>
  );
  if (k === "link") {
    return (
      <button type="button" data-testid={handle} onClick={onClick} style={onTone ? { color: tones[onTone].ink } : undefined} className={cn("cursor-pointer underline", !onTone && "text-ink", medium ? "text-[15px]" : "text-[14px]", className)}>
        {content}
      </button>
    );
  }
  // Quiet words stay words when they cannot act: at half strength, no hover, no clicks, never on a disabled face.
  if (kind === "quiet") {
    return (
      <button type="button" data-testid={handle} disabled={disabled} onClick={onClick} style={onTone ? { color: tones[onTone].ink } : undefined} className={cn("text-[13px]", disabled ? "opacity-50" : "cursor-pointer hover:underline", !onTone && "text-tertiary", !onTone && !disabled && "hover:text-secondary", className)}>
        {content}
      </button>
    );
  }
  const fg = toned ? toned.ink : k === "primary" || k === "danger" ? palette.onSolid : k === "tinted" ? tones[tone].ink : k === "ghost" ? palette.secondary : k === "disabled" ? palette.faint : palette.ink;
  const secondary = k === "secondary";
  const restFill = fill ?? palette.area;
  const hoverFill = fill === undefined || fill === palette.area ? palette.pressed : palette.area;
  return (
    <button
      type="button"
      data-testid={handle}
      aria-label={label}
      disabled={k === "disabled" || loading}
      onClick={onClick}
      className={cn(
        "relative inline-flex max-w-full min-w-0 shrink-0 items-center justify-center whitespace-nowrap tracking-[0.05px] transition-transform duration-[120ms] ease-out",
        "rounded-button leading-5 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-focus",
        mini ? "text-[13px]" : "text-[14px]",
        // Small and mini reach 40pt tall through an invisible target.
        medium ? "h-10" : mini ? "h-7 gap-1 after:absolute after:-inset-y-1.5 after:content-['']" : "h-8 after:absolute after:-inset-y-1 after:content-['']",
        hover && !loading ? buttonFaceHover[k] : "",
        toned ? "bg-(--rest) text-(--ink) hover:bg-(--over) [.show-hover_&]:bg-(--over)" : buttonFace[k],
        !toned && secondary && "bg-(--rest) hover:bg-(--over) [.show-hover_&]:bg-(--over)",
        (secondary || toned) && hover && "bg-(--over)",
        k !== "disabled" && !loading ? "cursor-pointer active:scale-[0.97]" : "pointer-events-none",
        // Inert from the first moment, so it looks it: dimmed to 70%, which keeps the spinner readable.
        loading && "opacity-70 transition-opacity duration-[120ms]",
        kind === "ghost" && "[.hang>&:first-child]:-ml-(--pad)",
        kind === "ghost" && hang && "-ml-(--pad)",
        className,
      )}
      style={{
        ...({ paddingInline: pad, "--pad": `${pad}px` } as CSSProperties),
        ...(!toned && secondary ? ({ "--rest": restFill, "--over": hoverFill } as CSSProperties) : {}),
        // Tinted: the tone's ink on its fill, a step of that ink deeper on hover, edged with the ink at 8%.
        ...(k === "tinted"
          ? ({
              "--ink": tones[tone].ink,
              "--rest": tones[tone].fill,
              "--over": `color-mix(in oklab, ${tones[tone].fill}, ${tones[tone].ink} 10%)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tones[tone].ink} 8%, transparent)`,
            } as CSSProperties)
          : {}),
        // A raised face: a stone line under it, and the 5% edge on a grey one.
        ...(toned ? ({ "--rest": toned.rest, "--over": toned.over, "--ink": toned.ink, boxShadow: toned.edge } as CSSProperties) : {}),
        ...(!toned && (k === "primary" || k === "danger" || secondary || k === "selected")
          ? { boxShadow: [secondary || k === "selected" ? `inset 0 0 0 1px ${alpha(palette.ink, 0.06)}` : `inset 0 1px 0 ${palette.glint}`, "0 1px 2px rgb(0 0 0 / 0.05)"].filter(Boolean).join(", ") }
          : {}),
        ...(hover && secondary && !toned ? { background: hoverFill } : {}),
      }}
    >
      <span className={cn("inline-flex min-w-0 items-center", medium ? "gap-2" : "gap-1.5", spinning && "opacity-0")}>{content}</span>
      {spinning && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={14} color={fg} />
        </span>
      )}
    </button>
  );
}

// The least a pointer target measures on its short side.
const hitSize = 40;

// A square button holding one glyph. Without a fill it takes the surface's hover fill; with one, a step darker. With
// `tone` it is tinted, as a tinted button is: the tone's fill and ink, edged with the ink at 8%, a step darker on hover.
export function IconButton({
  glyph, label, fill, tone, color = palette.secondary, size = 28, disabled, copied, onClick,
}: { glyph: string; label: string; fill?: string; tone?: Tone; color?: string; size?: number; disabled?: boolean; copied?: boolean; onClick?: () => void }) {
  const t = tone ? tones[tone] : undefined;
  const face = t ? t.fill : fill;
  const ink = t ? t.ink : color;
  // The target reaches 40pt where the face is smaller: the width by 2pt a side (neighbours sit 2pt apart), the height by
  // the rest, never past the room a row leaves.
  const reach = Math.min(Math.max((hitSize - size) / 2, 0), 6);
  return (
    <Clickable
      fill={face ? "clear" : undefined}
      onClick={onClick}
      label={label}
      handle={`button:${label}`}
      disabled={disabled}
      style={{ "--hit-x": `${Math.min(reach, 2)}px`, "--hit-y": `${reach}px` } as CSSProperties}
      className="inline-flex shrink-0 transition-transform duration-[120ms] ease-out after:absolute after:-inset-x-(--hit-x) after:-inset-y-(--hit-y) after:content-[''] active:scale-[0.97]"
    >
      <span
        className="relative inline-flex items-center justify-center rounded-control"
        style={{ width: size, height: size, background: face, ...(t ? edge(alpha(t.ink, toneEdge)) : {}) }}
      >
        {copied === undefined ? <Glyph name={glyph} size={13} color={ink} width={1.6} /> : <CopyGlyph copied={copied} size={13} color={ink} width={1.6} />}
        {face && <span className="absolute inset-0 hidden rounded-control hovering:block" style={{ background: t ? alpha(t.ink, 0.1) : alpha(palette.ink, 0.06) }} />}
      </span>
    </Clickable>
  );
}

export type Lead =
  | { avatar: string; fill?: string; src?: string }
  | { visual: string }
  | { swap: { visual: string; over: string } }
  | { tile: string; tone: Tone }
  | { agent: true }
  | { check: boolean }
  | { radio: boolean }
  | { number: string }
  | { workspace: string };

export type ItemSize = "small" | "medium" | "dialog" | "large";

// Each size fixes the lead column, the gap after it, the title and subtitle sizes and the row height.
export const itemSize = {
  // Each lead spans its two lines at about 80% of their height (title and sub line heights together).
  small: { lead: 28, gap: 10, title: 13, sub: 12, row: 48 },
  medium: { lead: 32, gap: 12, title: 14, sub: 13, row: 60 },
  // A dialog's head: medium's lead, its title a step larger.
  dialog: { lead: 32, gap: 12, title: 15.5, sub: 13, row: 60 },
  large: { lead: 40, gap: 14, title: 22, sub: 14, row: 80 },
} as const;

export type ItemLine = { sub: string } | { over: string } | undefined;

export type ItemProps = {
  title: string;
  line?: ItemLine;
  lead?: Lead;
  size?: ItemSize;
  color?: string;
  monoSub?: boolean;
  wrap?: boolean;
  lineColor?: string;
  // A 6px dot before the subtitle: the state's colour, while the words stay quiet.
  lineDot?: string;
  trailing?: ReactNode;
  // The title's id, for what a dialog is named by.
  titleId?: string;
  className?: string;
};

// A title with either a subtitle or an overtitle, never both, and an optional lead spanning both lines. The title is
// always medium: a row never sets its own weight.
export function Item({ title, line, lead, size = "medium", color = palette.ink, monoSub, wrap, lineColor = palette.tertiary, lineDot, trailing, titleId, className }: ItemProps) {
  const m = itemSize[size];
  const large = size === "large";
  return (
    <div className={cn("flex min-w-0 flex-1 items-center", className)} style={{ gap: m.gap }}>
      {lead && <LeadView lead={lead} size={m.lead} />}
      <div className={cn("flex min-w-0 flex-1 flex-col items-start leading-[1.25]", large ? "gap-1" : "gap-0.5")}>
        {line && "over" in line && (
          <span className="max-w-full truncate" style={{ fontSize: m.sub, color: lineColor }}>
            {line.over}
          </span>
        )}
        <span
          id={titleId}
          className={cn("max-w-full", large ? "font-display" : "font-ui", !wrap && "truncate")}
          style={{ fontSize: m.title, fontWeight: 500, letterSpacing: large ? -0.3 : 0, color }}
        >
          {title}
        </span>
        {line && "sub" in line && (
          <span className={cn("flex max-w-full items-center gap-1.5", monoSub ? "font-mono" : "font-ui")} style={{ fontSize: monoSub ? m.sub - 0.5 : m.sub, color: lineColor }}>
            {lineDot && <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: lineDot }} />}
            <span className={cn("min-w-0", !wrap && "truncate")}>{line.sub}</span>
          </span>
        )}
      </div>
      {trailing}
    </div>
  );
}

export function LeadView({ lead, size }: { lead: Lead; size: number }) {
  const box: CSSProperties = { width: size, height: size };
  if ("avatar" in lead) return <Avatar initials={lead.avatar} size={size} fill={lead.fill} src={lead.src} />;
  if ("visual" in lead) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-control bg-area" style={{ ...box, ...edge(alpha(palette.ink, 0.05)) }}>
        <Glyph name={lead.visual} size={Math.round(size * 0.6)} color={palette.secondary} />
      </span>
    );
  }
  if ("swap" in lead) {
    // A visual that gives way to another glyph while its clickable is hovered.
    return (
      <span className="relative inline-flex shrink-0" style={box}>
        <span className="inline-flex transition-opacity duration-[120ms] ease-out hovering:opacity-0">
          <LeadView lead={{ visual: lead.swap.visual }} size={size} />
        </span>
        <span className="absolute inset-0 inline-flex items-center justify-center rounded-control bg-pressed opacity-0 transition-opacity duration-[120ms] ease-out hovering:opacity-100">
          <Glyph name={lead.swap.over} size={Math.round(size * 0.58)} color={palette.ink} width={1.6} />
        </span>
      </span>
    );
  }
  if ("tile" in lead) {
    const grey = lead.tone === "grey";
    const t = tones[lead.tone];
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-button"
        style={{ ...box, background: grey ? palette.area : t.fill, ...edge(grey ? alpha(palette.ink, 0.03) : alpha(t.ink, toneEdge)) }}
      >
        <Glyph name={lead.tile} size={Math.round(size * 0.6)} color={grey ? palette.secondary : t.ink} />
      </span>
    );
  }
  if ("agent" in lead) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-control bg-primary" style={box}>
        <Glyph name="agent" size={size / 2} color={palette.onSolid} width={1.6} />
      </span>
    );
  }
  if ("check" in lead) {
    // The box on a very light rounded area, the avatar's size and with no edge, slightly darker while it or its row is
    // hovered (half way to pressed).
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-control bg-area transition-colors duration-[120ms] hover:bg-[color-mix(in_oklab,var(--color-area),var(--color-pressed))] hovering:bg-[color-mix(in_oklab,var(--color-area),var(--color-pressed))]"
        style={box}
      >
        <Checkbox on={lead.check} />
      </span>
    );
  }
  if ("radio" in lead) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center" style={box}>
        <Radio on={lead.radio} />
      </span>
    );
  }
  if ("number" in lead) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-control bg-area font-mono text-[12px] text-secondary" style={{ ...box, ...edge(alpha(palette.ink, 0.05)) }}>
        {lead.number}
      </span>
    );
  }
  return <WorkspaceTile name={lead.workspace} size={size} />;
}

// The empty box fades out under the fill as the check draws itself.
export function Checkbox({ on }: { on: boolean }) {
  return (
    <span data-on={on || undefined} className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-[4px]">
      <span className="swap absolute inset-0 rounded-[inherit] bg-page" style={{ outline: `1.5px solid ${palette.field}`, outlineOffset: -0.75, opacity: on ? 0 : 1 }} />
      <span className="swap absolute inset-0 rounded-[inherit] bg-primary" style={{ opacity: on ? 1 : 0 }} />
      <Glyph name="check" size={10} color={palette.onSolid} width={2} className="draw relative" />
    </span>
  );
}

// The mark of a single choice, the one style everywhere (menus, cards, lists): an outlined circle, a filled one with
// a check once chosen. The filled circle scales in over the empty one, and the check draws itself.
export function Radio({ on }: { on: boolean }) {
  return (
    <span data-on={on || undefined} className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full">
      <span className="swap absolute inset-0 rounded-full" style={{ outline: `1.5px solid ${palette.field}`, outlineOffset: -0.75, opacity: on ? 0 : 1 }} />
      <span className="swap absolute inset-0 rounded-full" style={{ background: palette.primary, opacity: on ? 1 : 0, transform: on ? undefined : "scale(0.4)" }} />
      <Glyph name="check" size={10} color={palette.onSolid} width={2} className="draw relative" />
    </span>
  );
}

// The workspace's initial on a tile whose fill is locked by the name, as an avatar's by its initials.
export function WorkspaceTile({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-pill font-semibold text-secondary"
      style={{ width: size, height: size, fontSize: size / 2, background: avatarFill(name) }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

// `tone`: on, the track takes that tone's ink instead of the primary blue (the composer's Note switch, in the note's).
// `small`: 14 by 24, for a switch inside a control row (the composer's Note).
function SwitchFace({ on, tone, small }: { on: boolean; tone?: Tone; small?: boolean }) {
  return (
    <span className={cn("relative inline-block shrink-0 rounded-full transition-colors duration-[120ms]", small ? "h-3.5 w-6" : "h-5 w-8", on ? !tone && "bg-primary" : "bg-pressed")} style={on && tone ? { background: tones[tone].ink } : undefined}>
      {/* The knob moves by translate, not by its left edge, so the move is composited. */}
      <span className={cn("absolute top-0.5 left-0.5 rounded-full bg-page shadow-knob transition-[translate] duration-[120ms] ease-out", small ? "size-2.5" : "size-4", on && (small ? "translate-x-2.5" : "translate-x-3"))} />
    </span>
  );
}

// A switch and its label; the whole of it is clickable, with a hover fill a little past its edges.
export function Toggle({ label, on, onChange, disabled, tone, small }: { label: string; on: boolean; onChange?: (on: boolean) => void; disabled?: boolean; tone?: Tone; small?: boolean }) {
  return (
    <Clickable bleed={6} onClick={() => onChange?.(!on)} disabled={disabled} handle={`toggle:${label}`} chosen={on} className={cn("-my-1 inline-flex items-center py-1", small ? "gap-1.5" : "gap-2.5")}>
      <SwitchFace on={on} tone={tone} small={small} />
      <span className={cn(small ? "text-[12.5px]" : "text-[14px]", !tone ? "text-ink" : !on && "text-secondary")} style={tone && on ? { color: tones[tone].ink } : undefined}>{label}</span>
    </Clickable>
  );
}

// A static switch for boards and lists where the value is not bound.
export function SwitchMark({ label = "", on }: { label?: string; on: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <SwitchFace on={on} />
      {label && <span className="text-[14px] text-ink">{label}</span>}
    </span>
  );
}

export type FieldBoxProps = {
  value: string;
  placeholder?: boolean;
  mono?: boolean;
  error?: boolean;
  focus?: boolean;
  rows?: number;
  select?: boolean;
  glyph?: string;
  size?: FieldSize;
  hover?: boolean;
  disabled?: boolean;
  className?: string;
};

// The white box of a text field or select, drawn without a platform control; its edge, not its fill, shows hover.
export function FieldBox({ value, placeholder, mono, error, focus, rows = 1, select, glyph, size = "medium", hover, disabled, className }: FieldBoxProps) {
  const one = rows === 1;
  return (
    <div
      className={cn(
        "relative flex w-full gap-2 rounded-control",
        one ? "items-center" : "items-start py-2.5",
        size === "medium" ? "px-3" : "px-2.5",
        error ? "bg-red-fill" : "bg-page",
        !error && (hover ? "shadow-[inset_0_0_0_1px_var(--color-field-hover)]" : "shadow-[inset_0_0_0_1px_var(--color-field)] hovering:shadow-[inset_0_0_0_1px_var(--color-field-hover)]"),
        disabled && "opacity-50",
        className,
      )}
      style={{ height: one ? fieldSize[size].height : rows * 22 + 20, ...(error ? edge(alpha(tones.red.ink, 0.5)) : {}) }}
    >
      {glyph && <Glyph name={glyph} size={13} color={palette.tertiary} />}
      <span className={cn("min-w-0 flex-1", one ? "truncate" : "whitespace-pre-wrap", mono ? "font-mono text-[13px]" : "text-[14px]", placeholder ? "text-tertiary" : "text-ink")}>{value}</span>
      {select && (
        <Turn menu>
          <Glyph name="chevronDown" size={16} color={palette.secondary} width={1.6} />
        </Turn>
      )}
      {focus && <span className="pointer-events-none absolute -inset-[0.75px] rounded-control" style={{ boxShadow: fieldFocus }} />}
    </div>
  );
}

// What a field tells the controls inside it: the line that describes them, and whether it is an error.
export const FieldLine = createContext<{ id: string; invalid: boolean } | undefined>(undefined);

// A label above, a control, help or an error under it. The line is linked to the control; an error is announced.
export function Field({ label, required, help, error, children, className }: { label: string; required?: boolean; help?: string; error?: string; children: ReactNode; className?: string }) {
  const line = useId();
  const described = !!(error || help);
  return (
    <div className={cn("flex flex-col items-stretch gap-2", className)}>
      <div className="flex items-center gap-1 text-[13px]">
        <span className="font-medium text-ink">{label}</span>
        {required && <span className="text-tertiary">required</span>}
      </div>
      <FieldLine.Provider value={described ? { id: line, invalid: !!error } : undefined}>{children}</FieldLine.Provider>
      {error ? (
        <span id={line} role="alert" className="text-[12px] text-red-ink">{error}</span>
      ) : help ? (
        <span id={line} className="text-[12px] text-tertiary">{help}</span>
      ) : null}
    </div>
  );
}

// A choice card: title, detail and a round mark, on white; the selected one has a blue ring. It fills its cell, so
// cards side by side share one height, and the detail sits on the bottom edge.
// `tag` names a state of the choice beside its title ("Default": what they get if nothing is changed).
export function Choice({ title, detail, selected, onClick, disabled, tag }: { title: string; detail: string; selected: boolean; onClick?: () => void; disabled?: boolean; tag?: string }) {
  const face = (
    <div
      className={cn(
        "relative flex h-full w-full items-start gap-3 rounded-block bg-page px-4 py-3.5",
      )}
      style={selected ? undefined : edge(palette.field)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 self-stretch">
        <span className="flex min-h-5 items-center gap-2">
          <span className="text-[14px] font-semibold text-ink">{title}</span>
          {tag && <Tag text={tag} size="small" />}
        </span>
        <span className="mt-auto text-[13px] whitespace-pre-line text-tertiary">{detail}</span>
      </div>
      <span className="mt-0.5 inline-flex">
        <Radio on={selected} />
      </span>
      {selected && <span className="pointer-events-none absolute -inset-[0.75px] rounded-block" style={edge(palette.primary, 1.5)} />}
    </div>
  );
  if (!onClick) return <div data-testid={`choice:${title}`} aria-selected={selected} className="h-full">{face}</div>;
  return (
    <Clickable fill="clear" radius={8} onClick={onClick} disabled={disabled} label={title} handle={`choice:${title}`} chosen={selected} className="flex h-full">
      {face}
    </Clickable>
  );
}

// A Choice that became a field: the same card, ringed and its radio on, its title kept, the words typed where its
// detail was. A
// question's own answer morphs into it once picked; focusing it is picking it.
// The lines a ChoiceField opens to.
const choiceFieldLines = 3;

export function ChoiceField({ title, placeholder, value, onChange, onFocus, autoFocus }: { title: string; placeholder: string; value: string; onChange: (value: string) => void; onFocus?: () => void; autoFocus?: boolean }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const opened = useRef(false);
  // It opens from the detail's one line to three, then grows with its words, up to eight lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => {
      const was = el.style.height;
      el.style.height = "auto";
      const target = `${Math.min(Math.max(el.scrollHeight, choiceFieldLines * 20), 8 * 20)}px`;
      el.style.height = was;
      return target;
    };
    if (!opened.current) {
      opened.current = true;
      el.style.height = "20px";
      requestAnimationFrame(() => (el.style.height = fit()));
    } else {
      el.style.height = fit();
    }
  }, [value]);
  return (
    <div data-testid={`choicefield:${title}`} className="relative flex w-full items-start gap-3 rounded-block bg-page px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-h-5 items-center text-[14px] font-semibold text-ink">{title}</span>
        <textarea
          ref={area}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-5 min-w-0 resize-none bg-transparent p-0 text-[13px] leading-5 text-ink transition-[height] duration-200 ease-out outline-none placeholder:text-tertiary"
        />
      </div>
      <span className="mt-0.5 inline-flex">
        <Radio on />
      </span>
      <span className="pointer-events-none absolute -inset-[0.75px] rounded-block" style={edge(palette.primary, 1.5)} />
    </div>
  );
}

// A segmented control: a grey track as wide as its segments, never stretched by its column; one white pill under the
// chosen segment slides to the next choice (useSlide). A segment with a reason in `refused` is disabled and shows the
// reason as its hint. With `glyphs`, each segment shows its glyph alone and the item names it for assistive tools and
// tests. With `fill`, the track spans its column and every segment takes an equal share of it.
export function Segments({ items, selection, onChange, glyphs, refused, fill }: { items: string[]; selection: number; onChange?: (i: number) => void; glyphs?: string[]; refused?: (string | undefined)[]; fill?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useSlide(track, selection);
  return (
    <div ref={track} className={cn("relative inline-flex shrink-0 gap-0.5 rounded-full bg-area p-[3px]", fill ? "w-full" : "w-fit")} style={edge(alpha(palette.ink, 0.05))}>
      {items.map((item, i) => {
        const on = i === selection;
        const reason = refused?.[i];
        return (
          <Clickable key={item} fill={on ? "clear" : palette.pressed} radius={999} onClick={() => onChange?.(i)} label={item} handle={`segment:${item}`} chosen={on} disabled={!!reason} title={reason} className={cn("relative z-[1] inline-flex rounded-full", fill && "flex-1")}>
            <span
              className={cn("inline-flex h-[26px] items-center justify-center rounded-full text-[13px]", fill ? "w-full" : glyphs ? "w-9" : "px-3", on ? "text-ink" : "text-secondary", reason && "opacity-50")}
              style={{ transition: slideText }}
            >
              {glyphs ? <Glyph name={glyphs[i]} size={14} color={on ? palette.ink : palette.secondary} /> : item}
            </span>
          </Clickable>
        );
      })}
      <span aria-hidden className="pointer-events-none absolute top-[3px] left-0 h-[26px] rounded-full bg-page shadow-chosen" style={pill} />
    </div>
  );
}

// A line dividing layout: horizontal, or vertical between panes.
export function Rule({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div className={cn("shrink-0 bg-line", vertical ? "w-px self-stretch" : "h-px w-full", className)} />;
}
