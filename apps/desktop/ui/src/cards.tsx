import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { Dropdown, menu } from "./menu";
import { Item, Rule, TagFace, alpha, edge, type ItemLine } from "./primitives";
import { palette, tone } from "./tokens";

export type ThumbnailKind = "document" | "deck" | "app";

// A share of the thumbnail's width or height; the thumbnail is a size container.
const w = (share: number) => `${share * 100}cqw`;
const h = (share: number) => `${share * 100}cqh`;

// A rounded line taking `share` of the width it sits in.
function Line({ share, height, color }: { share: number; height: number; color: string }) {
  return (
    <div className="w-full shrink-0" style={{ height: h(height) }}>
      <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
    </div>
  );
}

const sheet: CSSProperties = { borderRadius: 3, background: palette.page, ...edge(alpha(palette.ink, 0.04)) };
const strong = alpha(palette.secondary, 0.55);
const soft = alpha(palette.faint, 0.7);

// A small drawing of what something is: a page, a deck or an app window, on grey. `src`, when given, is its picture
// (a path or URL to an image), shown from the top in place of the drawing.
export function Thumbnail({ kind, src, className }: { kind: ThumbnailKind; src?: string; className?: string }) {
  if (src) {
    return (
      <div className={cn("relative h-full w-full overflow-hidden bg-area", className)}>
        <img src={src} alt="" draggable={false} className="absolute inset-0 size-full object-cover object-top" />
      </div>
    );
  }
  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-area [container-type:size]", className)}>
      <div className="absolute inset-0 flex items-center justify-center">
        {kind === "document" && (
          <div
            className="flex flex-col items-start"
            style={{ ...sheet, width: w(0.62), height: h(0.86), padding: w(0.09), gap: h(0.045), transform: `translateY(${h(0.1)})` }}
          >
            <Line share={0.55} height={0.06} color={strong} />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Line key={i} share={i % 3 === 2 ? 0.6 : 0.92} height={0.032} color={soft} />
            ))}
          </div>
        )}
        {kind === "deck" && (
          <div className="relative" style={{ width: w(0.72), height: h(0.6) }}>
            <div className="absolute inset-0 rounded-[3px] bg-page opacity-60" style={{ transform: `translate(${w(0.04)}, ${h(-0.06)})` }} />
            <div className="absolute inset-0 flex flex-col" style={{ ...sheet, padding: w(0.07), gap: h(0.06) }}>
              <Line share={0.5} height={0.08} color={strong} />
              <div className="flex min-h-0 flex-1 items-end" style={{ gap: w(0.03) }}>
                {[0.35, 0.6, 0.45, 0.8].map((v) => (
                  <div key={v} className="flex-1 rounded-[1px]" style={{ height: h(0.32 * v), background: alpha(tone.blue.dot, 0.55) }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {kind === "app" && (
          <div className="relative flex flex-col overflow-hidden rounded-[3px] bg-page" style={{ width: w(0.8), height: h(0.72) }}>
            <div className="flex shrink-0 items-center gap-[3px] bg-quiet px-1.5" style={{ height: h(0.1) }}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1 rounded-full bg-faint" />
              ))}
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="shrink-0 bg-quiet" style={{ width: w(0.2) }} />
              <div className="flex min-w-0 flex-1 flex-col items-start" style={{ padding: w(0.05), gap: h(0.05) }}>
                <Line share={0.5} height={0.05} color={strong} />
                <div
                  className="w-full shrink-0 rounded-[2px]"
                  style={{ height: h(0.2), background: tone.green.fill, ...edge(alpha(tone.green.ink, 0.1)) }}
                />
                <Line share={0.8} height={0.03} color={soft} />
                <Line share={0.6} height={0.03} color={soft} />
              </div>
            </div>
            <span className="pointer-events-none absolute inset-0 rounded-[3px]" style={edge(alpha(palette.ink, 0.04))} />
          </div>
        )}
      </div>
    </div>
  );
}

// A card's edge, darker while the card is hovered. A divider inside the card is CardRule, the same colour.
export function CardEdge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-0 rounded-block shadow-ring transition-shadow duration-[120ms] ease-out hovering:shadow-ring-over",
        className,
      )}
    />
  );
}

// A divider inside a card: the card edge's colour, darkening with it while the card is hovered.
export function CardRule({ vertical }: { vertical?: boolean }) {
  return <Rule vertical={vertical} className="bg-card-edge transition-colors duration-[120ms] ease-out hovering:bg-card-edge-over" />;
}

export type TileProps = {
  title: string;
  // A size, a kind: the line under the title.
  sub?: string;
  // The picture, filling a square.
  visual: ReactNode;
  open?: () => void;
  // The test handle; `card:<title>` when unset.
  handle?: string;
  // Something on the visual's top right corner (an artifact's version).
  corner?: ReactNode;
  className?: string;
};

// A small square card: the whole tile is a square, the title and its line on the bottom edge and the visual filling
// what is left above them (cropped, never stretching the tile). A message's files and a turn's captures.
export function Tile({ title, sub, visual, open, handle, corner, className }: TileProps) {
  return (
    <Clickable fill="clear" radius={8} onClick={open} label={title} handle={handle ?? `card:${title}`} className={cn("flex aspect-square min-w-0", className)}>
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-block bg-page transition-[scale] duration-[120ms] ease-out pressing:scale-(--press-scale)">
        <div className="relative min-h-0 w-full flex-1 overflow-hidden">
          {visual}
          {corner && <div className="absolute top-2 right-2 flex">{corner}</div>}
        </div>
        <div className="flex shrink-0 flex-col">
          <CardRule />
          <div className="flex px-2.5 py-2">
            <Item title={title} line={sub ? { sub } : undefined} size="small" />
          </div>
        </div>
        <CardEdge />
      </div>
    </Clickable>
  );
}

// One saved version of an artifact, as the card's menu lists it: who saved it, when.
export type SavedVersion = { number: number; author: string; time: string };

export type ArtifactCardProps = {
  title: string;
  // Its kind and size, under the title.
  line?: string;
  excerpt?: string;
  visual: ReactNode;
  // The version this card shows; with `versions`, a menu lists them all, the newest first.
  version?: number;
  versions?: SavedVersion[];
  // Opens the artifact at a version (the shown one by default).
  open?: (version?: number) => void;
  // "horizontal" in the conversation; "tile" a square among others, as a message's files are.
  axis?: "horizontal" | "tile";
};

// An artifact in the conversation: a horizontal VisualCard, its version always on the top right. With more than one
// version, that tag opens a menu of them (who saved each, when); a choice opens the artifact at that version.
export function ArtifactCard({ title, line, excerpt, visual, version, versions, open, axis = "horizontal" }: ArtifactCardProps) {
  const label = version !== undefined ? `Version ${version}` : undefined;
  const many = (versions?.length ?? 0) > 1;
  const tag = !label ? null : many ? (
    <span aria-label={label} data-testid={`versions:${title}`} className="inline-flex shrink-0">
      <Dropdown
        edge="trailing"
        fill="clear"
        entries={[...versions!].sort((a, b) => b.number - a.number).map((v) => menu.item(`Version ${v.number}`, { detail: `${v.author} · ${v.time}`, radio: true, checked: v.number === version, action: () => open?.(v.number) }))}
        label={() => <TagFace text={label} size="small" menu live />}
      />
    </span>
  ) : (
    <TagFace text={label} size="small" />
  );
  if (axis === "tile") return <Tile title={title} sub={line} visual={visual} open={() => open?.(version)} corner={tag} />;
  // A sober shadow under the pointer, beside the edge's darkening.
  return <VisualCard axis="horizontal" title={title} line={line ? { sub: line } : undefined} excerpt={excerpt} visual={visual} open={() => open?.(version)} trailing={tag} className="rounded-block transition-shadow duration-[120ms] ease-out hover:shadow-lift" />;
}

export type VisualCardProps = {
  axis: "vertical" | "horizontal";
  title: string;
  line?: ItemLine;
  excerpt?: string;
  visual: ReactNode;
  trailing?: ReactNode;
  open?: () => void;
  className?: string;
};

// A card that leads with a visual. Vertical: the visual on top, then the text. Horizontal: the visual on the
// left, the text beside it. Both use `Item` for the text and the card edge of every surface.
export function VisualCard({ axis, title, line, excerpt, visual, trailing, open, className }: VisualCardProps) {
  const vertical = axis === "vertical";
  const text = (
    <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2">
      <div className="flex items-start gap-2">
        <Item title={title} line={line} size="small" />
        <span className="w-2 shrink-0" />
        {trailing && <div className="flex shrink-0">{trailing}</div>}
      </div>
      {excerpt && (
        // Lines 3 apart, with no leading above the first or under the last.
        <span className={cn("-my-[1.5px] text-[13px] leading-[18.7px] text-secondary", vertical ? "line-clamp-2" : "line-clamp-3")}>{excerpt}</span>
      )}
    </div>
  );
  return (
    <Clickable fill="clear" radius={8} onClick={open} label={title} handle={`card:${title}`} className={cn("flex min-w-0", className)}>
      <div className={cn("relative flex w-full overflow-hidden rounded-block bg-page transition-[scale] duration-[120ms] ease-out pressing:scale-(--press-scale)", vertical ? "flex-col" : "items-stretch")}>
        {vertical ? (
          <>
            <div className="aspect-[16/10] w-full">{visual}</div>
            <CardRule />
            <div className="flex p-3">{text}</div>
          </>
        ) : (
          <>
            <div className="w-[148px] shrink-0 self-stretch">{visual}</div>
            <CardRule vertical />
            <div className="flex min-w-0 flex-1 px-3.5 py-3">{text}</div>
          </>
        )}
        <CardEdge />
      </div>
    </Clickable>
  );
}
