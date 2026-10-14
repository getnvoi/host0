import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import {
  closestCenter, DndContext, getFirstCollision, MeasuringStrategy, pointerWithin, rectIntersection, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter, type UniqueIdentifier,
} from "@dnd-kit/core";
import { defaultAnimateLayoutChanges, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { Glyph } from "./glyph";
import { DragLayer, dragStill, stepAside, useDragSensors } from "./sortable";
import { Surface } from "./surface";
import { alpha, Button, Count, Dot, edge, Item, Rule, Spinner, Tag, type Person, type TabStatus } from "./primitives";
import { AvatarStack } from "./avatars";
import { measure, palette, tone as tones, type Tone } from "./tokens";

// The product's name, in the landing page's serif.
export function Wordmark({ size = 26, color = palette.ink }: { size?: number; color?: string }) {
  return (
    <span className="font-serif leading-[1.3]" style={{ fontSize: size, letterSpacing: -0.3, color }}>
      hz
    </span>
  );
}

// A serif heading in two short lines, as on the landing page: the statement in ink, then a grey line that
// completes it.
export function SerifHeading({ first, second, size = 44 }: { first: string; second: string; size?: number }) {
  return (
    <div className="flex flex-col items-start font-serif leading-[1.3] [text-wrap:balance]" style={{ fontSize: size, letterSpacing: -size * 0.012, gap: 0 }}>
      <span className="text-ink">{first}</span>
      <span className="text-tertiary" style={{ marginTop: -size * 0.14 }}>
        {second}
      </span>
    </div>
  );
}

const bayer = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Draws the dither field on a context of `width` × `height` points.
export function drawDither(ctx: CanvasRenderingContext2D, width: number, height: number, strength: number, color: string) {
  const cw = 5;
  const ch = 12;
  const cols = Math.floor(width / cw) + 1;
  const rows = Math.floor(height / ch) + 1;
  ctx.strokeStyle = color;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i / Math.max(cols, 1);
      const y = j / Math.max(rows, 1);
      const ribbon = 0.5 + 0.5 * Math.sin(x * 7.3 + Math.sin(y * 3.1) * 2.2) * Math.cos(y * 5.7 - x * 2.4);
      const v = ribbon * Math.min(1, Math.max(0, (x - 0.1) * 1.4)) * Math.min(1, Math.max(0, (y - 0.05) * 2.5));
      const t = (bayer[j % 4][i % 4] + 0.5) / 16;
      if (!(v > t)) continue;
      const px = i * cw + cw / 2;
      const py = j * ch + 1;
      ctx.globalAlpha = Math.min(1, 0.14 * strength * (0.5 + v));
      ctx.lineWidth = v > 0.8 ? 1.4 : v > 0.55 ? 1.0 : 0.6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + ch - 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// The landing page's dither field: short vertical strokes in 5 × 12 cells, kept by a 4 × 4 Bayer threshold along
// drifting ribbons, in three weights. `strength` dims it to a watermark. It fills its parent.
export function DitherField({ strength = 1, color = palette.ink, className }: { strength?: number; color?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const scale = devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawDither(ctx, width, height, strength, color);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strength, color]);
  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}

// A beige panel with the dither field, as the landing page's hero and bento cards.
export function StonePanel({ dither = 0.6, children, className }: { dither?: number; children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn("relative flex size-full flex-col items-start overflow-hidden rounded-[24px]", className)}
      style={{ background: `linear-gradient(${palette.stone}, ${palette.stoneLow})` }}
    >
      <DitherField strength={dither} />
      <div className="relative flex size-full flex-col items-start">{children}</div>
      <span className="pointer-events-none absolute inset-0 rounded-[24px]" style={edge(alpha(palette.ink, 0.03))} />
    </div>
  );
}

export type StepState = "done" | "current" | "todo";
export type BandStep = { label: string; value?: string; state: StepState };

// The steps of a flow as a band of equal cells between dividers; the current one underlined, a done one checked
// with its answer under its name.
export function StepsBand({ steps }: { steps: BandStep[] }) {
  return (
    <div className="relative flex shrink-0">
      {steps.map((step, i) => (
        <div key={i} data-testid={`step:${step.label}`} className="relative flex h-[52px] min-w-0 flex-1 basis-0 items-center gap-2 px-4">
          {step.state === "done" ? (
            <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-ink">
              <Glyph name="check" size={9} color={palette.onSolid} width={2} />
            </span>
          ) : (
            <span
              className={cn("inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-page font-mono text-[10.5px]", step.state === "todo" ? "text-secondary" : "text-ink")}
              style={edge(step.state === "todo" ? palette.faint : palette.ink, step.state === "current" ? 1.5 : 1)}
            >
              {i + 1}
            </span>
          )}
          <div className="flex min-w-0 flex-col items-start gap-px">
            <span className={cn("max-w-full truncate text-[13px]", step.state === "current" && "font-medium", step.state === "todo" ? "text-tertiary" : "text-ink")}>
              {step.label}
            </span>
            {step.value && step.state === "done" && <span className="max-w-full truncate text-[11px] text-tertiary">{step.value}</span>}
          </div>
          {step.state === "current" && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />}
          {i < steps.length - 1 && <span className="absolute inset-y-0 right-0 w-px bg-line" />}
        </div>
      ))}
      <Rule className="pointer-events-none absolute inset-x-0 bottom-0" />
    </div>
  );
}

export type OnboardingPoint = { glyph: string; title: string; text: string };

export type OnboardingFrameProps = {
  kicker?: string;
  heading: { first: string; second: string };
  text: string;
  points?: OnboardingPoint[];
  fine?: string;
  steps?: BandStep[];
  title: string;
  lede?: string;
  // The signed-in email, with Sign out beside it.
  who?: string;
  signOut?: () => void;
  children?: ReactNode;
  // A frame with nothing to act on (loading, an error) has no foot, nor its line.
  foot?: ReactNode;
};

// Every first-run screen (signing in, the workspace, onboarding): the context on a stone panel on the left
// (wordmark, where, the two-line serif heading, why, what it promises, who is signed in at its foot) and a white
// frame on the right, full height, whose steps band and foot stay while its body scrolls. One decision per screen.
export function OnboardingFrame({ kicker, heading, text, points = [], fine, steps = [], title, lede, who, signOut = () => {}, children, foot }: OnboardingFrameProps) {
  return (
    <div className="flex size-full bg-page">
      <div className="w-[456px] shrink-0 p-2">
        <StonePanel dither={0.55}>
          <div className="flex size-full flex-col items-start gap-4 pt-9 pr-9 pb-6 pl-12">
            <span className="mb-11">
              <Wordmark />
            </span>
            {kicker && <span className="font-mono text-[11.5px] font-medium tracking-[0.9px] text-secondary uppercase">{kicker}</span>}
            <SerifHeading first={heading.first} second={heading.second} />
            <p className="m-0 max-w-[330px] text-[15px] leading-[23px] text-secondary">{text}</p>
            {points.length > 0 && (
              <div className="flex flex-col items-start gap-3 pt-2">
                {points.map((p, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="flex w-5 shrink-0 justify-center">
                      <Glyph name={p.glyph} size={18} color={palette.secondary} />
                    </span>
                    <div className="flex flex-col gap-px">
                      <span className="text-[13px] font-medium text-ink">{p.title}</span>
                      <span className="text-[13px] text-secondary">{p.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <span className="min-h-3.5 flex-1" />
            {fine && <span className="text-[12px] text-tertiary">{fine}</span>}
            {who && (
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] text-secondary">{who}</span>
                <Button kind="ghost" size="small" onClick={signOut}>
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </StonePanel>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {steps.length > 0 && <StepsBand steps={steps} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex w-full flex-col items-stretch gap-[18px] px-14 py-11" style={{ maxWidth: measure.column + 112 }}>
            <div className="flex flex-col items-start gap-1">
              {title && <span className="font-display text-[22px] font-medium tracking-[-0.4px] text-ink">{title}</span>}
              {lede && <span className="text-[13px] text-secondary">{lede}</span>}
            </div>
            {children}
          </div>
        </div>
        {foot && (
          // The foot starts on the body's text; a ghost button first in it hangs.
          <div className="hang relative flex shrink-0 items-center gap-2 py-3 pr-4 pl-14">
            {foot}
            <Rule className="pointer-events-none absolute inset-x-0 top-0" />
          </div>
        )}
      </div>
    </div>
  );
}

// A line between two halves of a form: "or".
export function OrDivider({ className }: { className?: string }) {
  return (
    <div className={cn("flex w-full items-center gap-2.5", className)}>
      <Rule className="flex-1" />
      <span className="text-[12px] text-tertiary">or</span>
      <Rule className="flex-1" />
    </div>
  );
}

// Nothing to show: a glyph, what is missing and how to get it; filtered, what matched nothing and how to clear.
// With the text alone, one line, as a filter that matched nothing. With a glyph or a title it is a dashed outline: a
// container that is empty on purpose, which gives a body with nothing in it a floor. The wrapper always fills the
// body, without a border; the outline sits centred in it at the content's own width, at most 60% of the body (all of it on a narrow window),
// or with `fill` fills it.
//
// Sizes: `page` (the default) is a page body's, as above. `small` is for a menu or a card: the dashed area fills the
// width and the height it is given, with a smaller glyph, text and padding; its action is a `mini` button.
export function EmptyState({ glyph, title, text, action, solid, fill, size = "page", role }: { glyph?: string; title?: string; text: string; action?: ReactNode; solid?: boolean; fill?: boolean; size?: "page" | "small"; role?: "alert" }) {
  const outline = !solid && (!!glyph || !!title);
  const small = size === "small";
  const face = (
    <>
      {glyph &&
        (outline ? (
          <Glyph name={glyph} size={small ? 20 : 30} color={palette.faint} />
        ) : (
          <span className="inline-flex size-10 items-center justify-center rounded-block bg-area" style={edge(alpha(palette.ink, 0.03))}>
            <Glyph name={glyph} size={20} color={palette.tertiary} />
          </span>
        ))}
      <div className="flex flex-col items-center gap-1">
        {title && <span className={cn("font-medium text-ink [text-wrap:balance]", small ? "text-[13px]" : "text-[14px]")}>{title}</span>}
        <span className="max-w-[360px] text-center text-[13px] text-secondary [text-wrap:pretty]">{text}</span>
      </div>
      {action}
    </>
  );
  if (!outline) {
    return (
      <div role={role} data-testid={`empty:${title ?? text}`} className="mt-(--state-offset,0px) flex min-h-[200px] w-full flex-1 flex-col items-center justify-center gap-3 py-8">
        {face}
      </div>
    );
  }
  if (small) {
    return (
      <div
        role={role}
        data-testid={`empty:${title ?? text}`}
        className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-2.5 rounded-block border border-dashed px-4 py-5"
        style={{ borderColor: palette.field }}
      >
        {face}
      </div>
    );
  }
  return (
    <div role={role} data-testid={`empty:${title ?? text}`} className="flex min-h-[200px] w-full flex-1 flex-col">
      <div
        className={cn("flex flex-col items-center justify-center gap-3 rounded-block border border-dashed p-6", fill ? "w-full flex-1" : "m-auto max-w-full px-28 py-24 lg:max-w-[60%]")}
        style={{ borderColor: palette.field }}
      >
        {face}
      </div>
    </div>
  );
}

// A body that failed to load: what went wrong, in the API's words, and a way to try again.
// `waiting`: a try is already scheduled; the button stays disabled until it runs.
export function ErrorState({ title = "Could not load this page", message, retry = () => {}, waiting }: { title?: string; message: string; retry?: () => void; waiting?: boolean }) {
  return (
    <EmptyState
      role="alert"
      solid
      glyph="retry"
      title={title}
      text={message}
      action={
        <Button size="small" glyph="retry" onClick={retry} disabled={waiting}>
          Try again
        </Button>
      }
    />
  );
}

export type BoardCardState = { word: string; tone: Tone; spin?: boolean };

export type BoardCardSpec = {
  // What the card stands for (a session's id); its title and age when none is given.
  id?: string;
  title: string;
  state?: BoardCardState;
  owner?: string;
  repo?: string;
  kind?: string;
  age: string;
  // A tab session's tab, shown in place of the repository.
  tab?: TabStatus;
  people?: Person[];
};

export type BoardLane = { name: string; tone: Tone; cards: BoardCardSpec[]; empty?: string };

const cardId = (card: BoardCardSpec) => card.id ?? card.title + card.age;

// Where a held card stands, for the gallery: lifted from its lane over the gap it leaves at `index` of `lane`, `x` and
// `y` points from that gap.
export type BoardPose = { card: string; lane: string; index: number; x: number; y: number };

// How near an edge of the board or a lane, as a share of its size, the pointer starts scrolling it while a card is held.
const scrollEdge = { x: 0.12, y: 0.15 };
// A board card lifts with Space; Enter opens it, and drops it while held.
const cardKeys = { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] };

// The lanes with `card` taken out of its own and put at `index` of `lane`.
function place(lanes: BoardLane[], card: string, lane: string, index: number): BoardLane[] {
  const held = lanes.flatMap((l) => l.cards).find((c) => cardId(c) === card);
  if (!held) return lanes;
  return lanes.map((l) => {
    const cards = l.cards.filter((c) => cardId(c) !== card);
    if (l.name === lane) cards.splice(Math.max(0, Math.min(index, cards.length)), 0, held);
    return { ...l, cards };
  });
}

// The lane holding `id`, a lane's name or a card's id.
const laneOf = (lanes: BoardLane[], id: UniqueIdentifier) => lanes.find((l) => l.name === id || l.cards.some((c) => cardId(c) === id));

// A held card, and the lanes as they stand while it moves (its place already in the lane under it).
type Hold = { card: BoardCardSpec; lanes: BoardLane[] };

// Things as lanes of cards: each lane a tab with its state dot and count, its cards rows split by lines. Every lane
// takes the same width; it scrolls sideways rather than squeezing a lane under 240pt. `loading`: the lanes' heads
// without counts over placeholder cards. A card is dragged within its lane or to another (pointer, or Space, the
// arrow keys, Space to drop, Escape to cancel); the board keeps the new order until its lanes change, and tells the
// screen through `move` once, on the drop. `locked`: nothing moves, for lanes the screen cannot save. `pose`: a held
// card, still, for the gallery.
export function Board({ lanes: given, open = () => {}, loading, move, locked, pose }: {
  lanes: BoardLane[];
  open?: (card: BoardCardSpec) => void;
  loading?: boolean;
  // `card` now stands at `index` of the lane named `lane`.
  move?: (card: BoardCardSpec, lane: string, index: number) => void;
  locked?: boolean;
  pose?: BoardPose;
}) {
  // The order a drop made, until the screen gives lanes holding other cards or another order.
  const [arranged, setArranged] = useState<BoardLane[]>();
  const order = given.map((l) => `${l.name}:${l.cards.map(cardId).join(",")}`).join("|");
  useEffect(() => setArranged(undefined), [order]);
  const lanes = arranged ?? given;
  const [hold, setHold] = useState<Hold | null>(null);
  // Whether the last drag moves without motion; kept past the drop, which lands with or without it.
  const [still, setStill] = useState(true);
  const live = useRef(hold);
  live.current = hold;
  // The click that ends a dragging press does not open the card.
  const dropped = useRef(false);
  const last = useRef<UniqueIdentifier | null>(null);
  // The arrows step from card to card, and to an empty lane; a lane that holds cards is reached through them.
  const steps: KeyboardCoordinateGetter = (event, args) => {
    const filled = new Set((live.current?.lanes ?? lanes).filter((l) => l.cards.length).map((l) => l.name));
    const all = args.context.droppableContainers;
    const kept = all.getEnabled().filter((c) => !filled.has(String(c.id)));
    const droppableContainers = { getEnabled: () => kept, get: (id: UniqueIdentifier) => all.get(id) } as typeof all;
    return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableContainers } });
  };
  const sensors = useDragSensors(cardKeys, steps);
  const shown = hold?.lanes ?? (pose ? place(lanes, pose.card, pose.lane, pose.index) : lanes);
  const held = hold ? cardId(hold.card) : pose?.card;
  const draggable = !locked && !loading;

  // Over a lane, the nearest of its cards; elsewhere what the pointer is in, else what the held card touches.
  const collide: CollisionDetection = (args) => {
    const now = live.current?.lanes ?? lanes;
    const within = pointerWithin(args);
    let over = getFirstCollision(within.length ? within : rectIntersection(args), "id");
    if (over == null) return last.current == null ? [] : [{ id: last.current }];
    const lane = now.find((l) => l.name === over);
    if (lane?.cards.length) {
      const ids = lane.cards.map(cardId);
      over = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))) })[0]?.id ?? over;
    }
    last.current = over;
    return [{ id: over }];
  };

  const start = ({ active, activatorEvent }: DragStartEvent) => {
    const card = lanes.flatMap((l) => l.cards).find((c) => cardId(c) === active.id);
    if (!card) return;
    setHold({ card, lanes });
    setStill(dragStill(activatorEvent));
  };

  // Into another lane: the gap opens there, above or below the card under it, as the held card's middle stands.
  const over = ({ active, over }: DragOverEvent) => {
    const now = live.current;
    if (!now || !over) return;
    const from = laneOf(now.lanes, active.id);
    const to = laneOf(now.lanes, over.id);
    if (!from || !to || from === to) return;
    const at = to.cards.findIndex((c) => cardId(c) === over.id);
    const rect = active.rect.current.translated;
    const below = rect && rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2;
    const index = at < 0 ? to.cards.length : at + (below ? 1 : 0);
    setHold({ ...now, lanes: place(now.lanes, String(active.id), to.name, index) });
  };

  const end = ({ active, over }: DragEndEvent) => {
    const now = live.current;
    setHold(null);
    last.current = null;
    dropped.current = true;
    setTimeout(() => (dropped.current = false));
    // Dropped away from every lane: it goes back.
    if (!now || !over) return;
    const lane = laneOf(now.lanes, active.id);
    if (!lane) return;
    const ids = lane.cards.map(cardId);
    const at = ids.indexOf(String(active.id));
    const target = ids.indexOf(String(over.id));
    const index = target < 0 ? at : target;
    const before = laneOf(lanes, active.id);
    if (before?.name === lane.name && before.cards.findIndex((c) => cardId(c) === active.id) === index) return;
    setArranged(place(lanes, String(active.id), lane.name, index));
    move?.(now.card, lane.name, index);
  };

  const cancel = () => {
    setHold(null);
    last.current = null;
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={{ threshold: scrollEdge }}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${title(lanes, active.id)}.`,
          onDragOver: ({ active, over }) => (over ? `${title(lanes, active.id)} is in ${laneOf(live.current?.lanes ?? lanes, over.id)?.name ?? "no lane"}.` : undefined),
          onDragEnd: ({ active, over }) => (over ? `Dropped ${title(lanes, active.id)}.` : `${title(lanes, active.id)} is back in its place.`),
          onDragCancel: ({ active }) => `Cancelled. ${title(lanes, active.id)} is back in its place.`,
        },
        screenReaderInstructions: { draggable: "Press Space to lift, the arrow keys to move between cards and lanes, Space to drop, Escape to cancel." },
      }}
      onDragStart={start}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={cancel}
    >
      <div className="h-full w-full overflow-x-auto">
        <div className="grid h-full grid-rows-[minmax(0,1fr)] gap-5 p-5" style={{ gridTemplateColumns: `repeat(${Math.max(shown.length, 1)}, minmax(240px, 1fr))` }}>
          {shown.map((lane, i) => (
            <LaneDrop key={lane.name} name={lane.name} disabled={!draggable}>
              {/* A lane is a card: its head, and the cards that scroll under it. */}
              <Surface
                preset="card"
                header={
                  <>
                    <Dot tone={lane.tone} />
                    <span className="text-[13px] font-medium text-ink">{lane.name}</span>
                    {!loading && <Count value={lane.cards.length} />}
                  </>
                }
              >
                {loading &&
                  [0, 1, 2].slice(0, 3 - (i % 2)).map((k) => (
                    <div key={k} aria-label="Loading" className="flex min-h-[84px] shrink-0 flex-col items-start gap-2.5 rounded-control bg-page p-3" style={edge(palette.line)}>
                      <span className="h-2.5 rounded-full bg-area" style={{ width: [160, 120, 190][(i + k) % 3] }} />
                      <span className="h-2 rounded-full bg-quiet" style={{ width: [110, 140, 80][(i + k) % 3] }} />
                    </div>
                  ))}
                {!loading && lane.cards.length === 0 && (
                  <div className="flex min-h-[84px] items-center justify-center rounded-control border border-dashed text-[13px] font-medium text-secondary" style={{ borderColor: palette.field }}>
                    {lane.empty ?? "Nothing here"}
                  </div>
                )}
                <SortableContext items={lane.cards.map(cardId)} strategy={verticalListSortingStrategy}>
                  {lane.cards.map((card) => (
                    <CardSlot
                      key={cardId(card)}
                      card={card}
                      lane={lane.name}
                      disabled={!draggable}
                      still={still}
                      gap={cardId(card) === held}
                      lifted={!hold && pose && cardId(card) === pose.card ? pose : undefined}
                      open={() => {
                        if (!dropped.current && !live.current) open(card);
                      }}
                    />
                  ))}
                </SortableContext>
              </Surface>
            </LaneDrop>
          ))}
        </div>
      </div>
      <DragLayer still={still} className="rounded-control">
        {hold && <BoardCard card={hold.card} lane={laneOf(hold.lanes, cardId(hold.card))?.name ?? ""} />}
      </DragLayer>
    </DndContext>
  );
}

const title = (lanes: BoardLane[], id: UniqueIdentifier) => lanes.flatMap((l) => l.cards).find((c) => cardId(c) === id)?.title ?? "The card";

// A lane as a place to drop: an empty one, or below its last card.
function LaneDrop({ name, disabled, children }: { name: string; disabled: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: name, disabled });
  return (
    <div ref={setNodeRef} className="flex min-h-0 min-w-0 flex-col *:min-h-0 *:flex-1">
      {children}
    </div>
  );
}

// A card in its lane. Held, its place stays open as a dashed gap of its height; the others step aside around it, and
// close up when it leaves for another lane. `lifted`: the gallery's held card, drawn over its gap.
function CardSlot({ card, lane, disabled, still, gap, lifted, open }: {
  card: BoardCardSpec;
  lane: string;
  disabled: boolean;
  still: boolean;
  gap: boolean;
  lifted?: BoardPose;
  open: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({
    id: cardId(card),
    disabled,
    transition: stepAside(still),
    // A card that changes lanes, and the cards it leaves, move to their places rather than jump.
    animateLayoutChanges: (args) => !still && defaultAnimateLayoutChanges({ ...args, wasDragging: true }),
  });
  const { role: _role, tabIndex: _tab, ...aria } = attributes;
  const grip: HTMLAttributes<HTMLDivElement> | undefined = disabled
    ? undefined
    : {
        ...aria,
        ...listeners,
        // A held card's keys drop or cancel it; they never open it.
        onKeyDown: (e) => {
          listeners?.onKeyDown?.(e);
          if (gap) e.preventDefault();
        },
      };
  return (
    <div
      ref={setNodeRef}
      className="relative flex shrink-0 flex-col items-stretch"
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition, zIndex: lifted ? 1 : undefined }}
    >
      <div className={cn("flex flex-col items-stretch", gap && "invisible")}>
        <BoardCard card={card} lane={lane} open={open} grip={grip} />
      </div>
      {gap && <span className="pointer-events-none absolute inset-0 rounded-control border border-dashed" style={{ borderColor: palette.field }} />}
      {lifted && (
        <div className="pointer-events-none absolute inset-0 cursor-grabbing rounded-control bg-page shadow-menu" style={{ transform: `translate(${lifted.x}px, ${lifted.y}px) scale(1.02)` }}>
          <BoardCard card={card} lane={lane} />
        </div>
      )}
    </div>
  );
}

// `grip`: what a draggable board gives the card to take the pointer and the keys.
export function BoardCard({ card, lane, open, grip }: { card: BoardCardSpec; lane: string; open?: () => void; grip?: HTMLAttributes<HTMLDivElement> }) {
  const state = card.state;
  return (
    <Clickable
      {...grip}
      fill="clear"
      radius={5}
      onClick={open}
      handle={`card:${card.title}`}
      label={card.title}
      className="flex min-h-[84px] flex-col items-start gap-1.5 rounded-control bg-page p-4 shadow-card transition-[translate,scale,box-shadow] duration-150 ease-out hover:-translate-y-px hover:shadow-card-over [.show-hover_&]:-translate-y-px [.show-hover_&]:shadow-card-over pressing:scale-(--press-scale)"
    >
      <span className="line-clamp-2 text-[13.5px] leading-[18px] font-medium tracking-[-0.17px] text-ink">{card.title}</span>
      {/* A state that repeats the lane's name is left out; its dot sits on the text edge, before its word. */}
      {state && state.word !== lane && (
        <span className="flex items-center gap-1.5">
          {state.spin ? <Spinner size={10} color={tones[state.tone].dot} /> : <Dot tone={state.tone} />}
          <span className="text-[12.5px] text-tertiary">{state.word}</span>
        </span>
      )}
      <span className="min-h-0 flex-1" />
      {/* As tall as a small tag, so a card keeps its height with or without one. */}
      <span className="flex min-h-[22px] w-full items-center gap-2">
        {/* The repository as everywhere: its owner above its name. */}
        {card.tab ? (
          <Item title={card.tab.owner || "Tab"} line={card.tab.owner ? { over: "Tab" } : undefined} lead={{ visual: "globe" }} size="small" color={palette.secondary} />
        ) : (
          <Item title={card.repo ?? ""} line={{ over: card.owner ?? "" }} lead={{ visual: "repo" }} size="small" color={palette.secondary} />
        )}
        {/* The item takes the free width itself (no spacer beside it to split it with), so it truncates only when full. */}
        {card.people?.length ? <AvatarStack people={card.people} size={20} limit={3} /> : null}
        <span className="shrink-0 font-mono text-[11.5px] text-tertiary tabular-nums">{card.age}</span>
        {card.kind && <Tag text={card.kind} size="small" />}
      </span>
    </Clickable>
  );
}
