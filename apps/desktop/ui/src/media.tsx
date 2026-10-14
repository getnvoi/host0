import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { CardEdge, Tile } from "./cards";
import { Backdrop, Clickable } from "./clickable";
import { Glyph } from "./glyph";
import { useEscape } from "./menu";
import { usePresence } from "./presence";
import { useScrollLock } from "./scrolllock";
import { IconButton, alpha, edge } from "./primitives";
import { Surface } from "./surface";
import { palette } from "./tokens";

// A file attached to a message (`TurnResource.files`). `src` opens the file itself; `thumb` is its first page or
// picture, rendered on a box, once `state` is ready. `state`: pending while it waits on a box, failed when it could
// not be read, none for a file with no picture.
export type FileView = {
  id: string;
  name: string;
  size?: string;
  contentType: string;
  src: string;
  thumb?: string;
  state: "ready" | "pending" | "failed" | "none";
};

// What the agent's browser kept in a turn (`TurnResource.captures`): a `screenshot`, or a `recording` of steps it
// played (an mp4, with its `poster` frame). `src` is the file's address, `thumb` a smaller copy; `url` the page it
// was taken of.
export type CaptureView = {
  id: string;
  kind: "screenshot" | "recording";
  label: string;
  url: string;
  src: string;
  thumb?: string;
  poster?: string;
  description?: string;
};

// One thing the lightbox shows: a picture, a PDF's pages, a video, or a document drawn as its first page (`thumb`,
// with Download). `download` names the file a Download saves.
export type LightboxItem = {
  id: string;
  title: string;
  caption?: string;
  kind: "image" | "pdf" | "video" | "document";
  src: string;
  thumb?: string;
  poster?: string;
  download?: string;
};

const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "";
};

export const lightboxItem = {
  file(f: FileView): LightboxItem {
    const type = f.contentType.split(";")[0].trim().toLowerCase();
    const kind = type.startsWith("image/") ? "image" : type === "application/pdf" ? "pdf" : type.startsWith("video/") ? "video" : "document";
    return { id: f.id, title: f.name, caption: f.size, kind, src: f.src, thumb: f.state === "ready" ? f.thumb : undefined, download: f.name };
  },
  capture: (c: CaptureView): LightboxItem => ({
    id: c.id, title: c.label, caption: c.description || c.url, kind: c.kind === "recording" ? "video" : "image", src: c.src, poster: c.poster,
  }),
};

// The picture of a file: its thumbnail once a box rendered it, a quiet grey while it waits, its type when it has none.
function FileFace({ file }: { file: FileView }) {
  // Both scale with the tile, keeping their proportions: a page fills the width from its top; a picture shows whole,
  // centred.
  if (file.state === "ready" && file.thumb)
    return <img src={file.thumb} alt="" className={cn("block h-full w-full bg-web", file.contentType.startsWith("image/") ? "bg-quiet object-contain" : "object-cover object-top")} />;
  if (file.state === "pending") return <div className="h-full w-full bg-area" />;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-quiet">
      <Glyph name={file.contentType.startsWith("image/") ? "image" : "file"} size={18} color={palette.tertiary} />
      <span className="font-mono text-[10px] text-tertiary">{extension(file.name)}</span>
    </div>
  );
}

// The files of a message under it, four to a row: each a square Tile, its picture, name and size. A click opens the
// file in the lightbox (`open`, by index).
export function FileTiles({ files, open }: { files: FileView[]; open?: (index: number) => void }) {
  return (
    // Four to a row across the message, each a square whatever the width.
    <div className="grid w-full grid-cols-4 gap-3" data-testid="files">
      {files.map((f, i) => (
        <Tile key={f.id} title={f.name} sub={f.size} visual={<FileFace file={f} />} open={open ? () => open(i) : undefined} handle={`file:${f.name}`} />
      ))}
    </div>
  );
}

// The captures of a turn, as a message's files are: square tiles side by side, each its picture (a recording its
// poster, with a play mark), what it shows, then what happens in it or the page it was taken of. A click opens it in
// the lightbox.
export function Captures({ captures, open }: { captures: CaptureView[]; open?: (capture: CaptureView) => void }) {
  return (
    <div className="grid w-full grid-cols-4 gap-3" data-testid="captures">
      {captures.map((c) => {
        const still = c.kind === "recording" ? c.poster : (c.thumb ?? c.src);
        const visual = (
          <div className="relative h-full w-full bg-area">
            {still && <img src={still} alt={c.label} className="block h-full w-full object-cover object-top" />}
            {c.kind === "recording" && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-9 items-center justify-center rounded-full bg-page" style={edge(alpha(palette.ink, 0.07))}>
                  <Glyph name="play" size={13} color={palette.ink} />
                </span>
              </span>
            )}
          </div>
        );
        return <Tile key={c.id} title={c.label} sub={c.description || c.url} visual={visual} open={open ? () => open(c) : undefined} handle={`picture:${c.label}`} />;
      })}
    </div>
  );
}

const floating = "var(--shadow-commander)";
const glyphOf: Record<LightboxItem["kind"], string> = { image: "image", pdf: "file", video: "play", document: "doc" };

// One file or capture, large, with the rest of its set a key away: a picture fills the width and scrolls, a PDF shows
// its pages, a video plays, a document shows its first page and saves with Download. A dialog over the scrim: Esc
// and a click on the scrim close it; ← and → (and the buttons in its foot) move through `items`.
export function Lightbox({ items, at, move, close, download }: {
  items: LightboxItem[];
  at: number;
  move?: (at: number) => void;
  close: () => void;
  download?: (item: LightboxItem) => void;
}) {
  // Full screen keeps the header and the foot and gives the picture the whole area; Esc leaves it before it closes.
  const [full, setFull] = useState(false);
  useEscape(() => (full ? setFull(false) : close()));
  const root = useRef<HTMLDivElement>(null);
  usePresence(root);
  useScrollLock(root);
  useEffect(() => {
    const listen = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && at > 0) move?.(at - 1);
      if (e.key === "ArrowRight" && at < items.length - 1) move?.(at + 1);
    };
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, [at, items.length, move]);
  const item = items[at];
  if (!item) return null;

  let body: ReactNode;
  if (item.kind === "video") {
    body = (
      <div className="flex h-full items-center justify-center p-4">
        <video key={item.id} src={item.src} poster={item.poster} controls autoPlay muted playsInline aria-label={item.title} data-testid={`video:${item.title}`} className="max-h-full max-w-full" />
      </div>
    );
  } else if (item.kind === "pdf") {
    body = <iframe key={item.id} src={item.src} title={item.title} className="block h-full w-full border-0 bg-web" />;
  } else if (item.kind === "image") {
    body = (
      <div className="h-full overflow-y-auto">
        <img key={item.id} src={item.src} alt={item.title} className="mx-auto block max-w-full" />
      </div>
    );
  } else {
    body = (
      <div className="flex h-full justify-center overflow-y-auto p-6">
        {item.thumb ? (
          <div className="relative h-fit w-full max-w-[640px] overflow-hidden rounded-block bg-page">
            <img src={item.thumb} alt={item.title} className="block w-full" />
            <CardEdge />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 self-center">
            <Glyph name="file" size={22} color={palette.tertiary} />
            <span className="text-[13px] text-tertiary">No preview of this file yet</span>
          </div>
        )}
      </div>
    );
  }

  return (
    // The drawers' 8pt margin on every side; full screen starts under the tab strip (40pt), which carries the window's buttons.
    <div ref={root} className={cn("fixed inset-0 z-40 flex items-center justify-center p-2", full && "pt-12")}>
      <Backdrop close={close} />
      <Surface
        preset="drawer"
        testid="dialog:Lightbox"
        className={cn(
          "relative w-full overflow-hidden rounded-[12px] presence-panel transition-[height,max-width] duration-[260ms] ease-(--ease-panel)",
          full ? "h-full max-w-full" : "h-[80vh] max-w-[1040px]",
        )}
        style={{ boxShadow: `inset 0 0 0 1px ${alpha(palette.ink, 0.03)}, ${floating}` }}
        title={item.title}
        line={item.caption ? { sub: item.caption } : undefined}
        lead={{ visual: glyphOf[item.kind] }}
        actions={
          <>
            <IconButton glyph={full ? "collapse" : "expand"} label={full ? "Exit full screen" : "Full screen"} fill={palette.area} onClick={() => setFull(!full)} />
            {item.download && download && <IconButton glyph="download" label="Download" fill={palette.area} onClick={() => download(item)} />}
          </>
        }
        close={close}
        scroll={false}
        footer={
          items.length > 1 && (
            <>
              <span className="flex-1 text-[13px] text-tertiary">
                {at + 1} of {items.length}
              </span>
              <IconButton glyph="back" label="Previous" fill={palette.area} disabled={at === 0} onClick={() => move?.(at - 1)} />
              <IconButton glyph="forward" label="Next" fill={palette.area} disabled={at === items.length - 1} onClick={() => move?.(at + 1)} />
            </>
          )
        }
      >
        <div className="min-h-0 flex-1 bg-area">{body}</div>
      </Surface>
    </div>
  );
}

// A picture shown whole in the space it is given, on the grey area, on white so a transparent image reads; a
// click opens it larger (`open`, the lightbox).
export function Picture({ src, title, open }: { src: string; title: string; open?: () => void }) {
  const face = (
    <span className="relative block max-h-full max-w-full overflow-hidden rounded-block bg-web" style={edge(alpha(palette.ink, 0.03))}>
      <img src={src} alt={title} data-testid={`picture:${title}`} className="block max-h-[calc(100vh-200px)] max-w-full object-contain" />
    </span>
  );
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-area p-6">
      {open ? (
        <Clickable onClick={open} label={`Open ${title}`} handle={`picture:${title}`} className="inline-flex max-h-full max-w-full">
          {face}
        </Clickable>
      ) : (
        face
      )}
    </div>
  );
}

// A video shown whole in the space it is given, with its controls, on the grey area.
export function Clip({ src, poster, title }: { src: string; poster?: string; title: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-area p-6">
      <span className="relative block max-h-full max-w-full overflow-hidden rounded-block bg-ink" style={edge(alpha(palette.ink, 0.03))}>
        <video src={src} poster={poster} controls playsInline aria-label={title} data-testid={`video:${title}`} className="block max-h-[calc(100vh-200px)] max-w-full" />
      </span>
    </div>
  );
}
