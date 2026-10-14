// Tokens as values, for what classes cannot carry (computed sizes, chart series, avatar fills).

export const palette = {
  ink: "var(--color-ink)",
  secondary: "var(--color-secondary)",
  tertiary: "var(--color-tertiary)",
  muted: "var(--color-muted)",
  faint: "var(--color-faint)",
  pressed: "var(--color-pressed)",
  area: "var(--color-area)",
  quiet: "var(--color-quiet)",
  // The window around the pages: the tab strip and the sidebar.
  frame: "var(--color-frame)",
  framePressed: "var(--color-frame-pressed)",
  page: "var(--color-page)",
  // The edge of a card and of the dividers inside it; a step darker while the card is hovered.
  cardEdge: "var(--color-card-edge)",
  // A page from outside the system (a preview, an artifact) stays white in both modes.
  web: "var(--color-web)",
  // Text and marks on a solid fill (primary, a tone's ink); the lit top edge of such a button.
  onSolid: "var(--color-on-solid)",
  glint: "var(--color-glint)",
  noteWash: "var(--color-note-wash)",
  fileWash: "var(--color-file-wash)",
  stoneLow: "var(--color-stone-low)",
  line: "var(--color-line)",
  stone: "var(--color-stone)",
  scrim: "var(--color-scrim)",
  // The one blue fill, from the marketing page: primary actions, send, a checked box.
  primary: "var(--color-primary)",
  // A field's edge, darker than a divider; its hover.
  field: "var(--color-field)",
  fieldHover: "var(--color-field-hover)",
} as const;

// How strong the edge of a tinted surface is: the tone's ink at this opacity.
export const toneEdge = 0.14;

// Status colours. Yellow is for approvals only, note for team notes only.
export type Tone = "blue" | "green" | "orange" | "red" | "yellow" | "note" | "grey";

export const tone = {
  blue: { ink: "var(--color-blue-ink)", fill: "var(--color-blue-fill)", dot: "var(--color-blue-dot)" },
  green: { ink: "var(--color-green-ink)", fill: "var(--color-green-fill)", dot: "var(--color-green-dot)" },
  orange: { ink: "var(--color-orange-ink)", fill: "var(--color-orange-fill)", dot: "var(--color-orange-dot)" },
  red: { ink: "var(--color-red-ink)", fill: "var(--color-red-fill)", dot: "var(--color-red-dot)" },
  yellow: { ink: "var(--color-yellow-ink)", fill: "var(--color-yellow-fill)", dot: "var(--color-yellow-dot)" },
  note: { ink: "var(--color-note-ink)", fill: "var(--color-note-fill)", dot: "var(--color-note-dot)" },
  grey: { ink: "var(--color-grey-ink)", fill: "var(--color-grey-fill)", dot: "var(--color-grey-dot)" },
} as const satisfies Record<Tone, { ink: string; fill: string; dot: string }>;

// Fills of avatars besides grey. Never white; yellow and sage mark states.
export const avatarFills = ["var(--color-avatar-slate)", "var(--color-avatar-olive)", tone.orange.fill, palette.pressed] as const;

// The fill locked to these initials: the same initials always get the same colour (djb2).
export function avatarFill(initials: string): string {
  let key = 5381;
  for (const ch of initials.toUpperCase()) {
    key = (Math.imul(key, 33) + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return avatarFills[key % avatarFills.length];
}

// Series step down one hue family, so a chart follows the hue; the last is the grey of what was removed.
export const chart = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", palette.faint] as const;

// Where text starts after a leading mark.
export const indent = { dot: 14, avatar: 28, hang: 12 + 28 } as const;

// The page's grid, measured from the outer left and right edges of whatever holds a row: a card in the conversation, a
// note, a strip, a gate, the composer's tray and box. `edgeInset`: the space between an outer edge and what is nearest
// it, on the left (the leading marks' slot) and on the right (the rightmost badge, chevron or button), in every row; it
// is also the space above the tray's first row and under the box's last row. A gate's form is the one exception: its
// right side keeps `textEdge`, as its left.
// `markSlot`: the width a mark is centred in, as wide as the widest mark (a radio). `markGap`: the space from the slot to
// the text after it. `markAxis`: the vertical through the centre of every leading mark (a gate's dot, an agent's glyph,
// an option's radio, the plus, the workflow ring, the note's pin). `textEdge`: where every leading text starts (labels,
// titles, options, the field, the hint).
export const edgeInset = 10;
export const markSlot = 16;
export const markGap = 8;
export const markAxis = edgeInset + markSlot / 2;
export const textEdge = markAxis + markSlot / 2 + markGap;

// `conversation`: the transcript's width. The transcript and the composer under it both take it, so their left and right
// edges are the same line. `column`: a form or a first-run page's content.
export const measure = { conversation: 760, column: 680, page: 760, search: 480, prose: 640, drawer: 480, wide: 1024, dialog: 640, code: 960 } as const;

export type FieldSize = "medium" | "small";
export const fieldSize = {
  medium: { height: 40, width: 240 },
  small: { height: 32, width: 220 },
} as const;
