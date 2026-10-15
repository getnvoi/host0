import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronDown, File } from "lucide-react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { hasFailed, useDelayedBusy } from "./busy";
import { cn } from "./cn";
import { DiffBlock, FileViewer, LiveTerminal, Notice, type DiffLine, type LiveTerminalStatus, type TerminalLine } from "./conversation";
import { WebFrame } from "./frame";
import { SearchField, type FileChange } from "./heads";
import { Surface } from "./surface";
import { Button, FieldBox, IconButton, LoadingState, Rule, Segments } from "./primitives";
import { EmptyState, ErrorState } from "./start";
import { measure, palette, tone } from "./tokens";

export type PreviewPaneState =
  // Served at this link.
  | { serving: string }
  // Asked to serve, or served while its link is read.
  | "starting"
  // The machine failed to start.
  | "failed"
  // Not served; the error when asking to serve failed.
  | { stopped: string | null }
  // Cannot be served, such as an environment with no preview command: the reason, and no Start.
  | { unavailable: string };

// `to_sentence`: "a", "a and b", "a, b and c".
function sentence(commands: string[]) {
  if (commands.length === 0) return "its preview commands";
  if (commands.length === 1) return commands[0];
  return `${commands.slice(0, -1).join(", ")} and ${commands[commands.length - 1]}`;
}

// The app a checkout serves: its address over the page, flush to the pane's edges, the page starting, or why it
// does not run with Start preview. Nothing starts until that click.
// `commands` are the ones Start preview runs; `open` takes the link to the browser; `reload` loads the page again.
// `frame`, when given, shows the served page in place of the web frame (the app's native preview).
export function PreviewPane({ state, commands = [], open, reload, start, frame }: { state: PreviewPaneState; commands?: string[]; open?: (url: string) => void; reload?: () => void; start?: () => void; frame?: ReactNode }) {
  // The starting indicator stays its minimum once it appeared, as every loading state does.
  const held = useDelayedBusy(state === "starting", state === "failed");
  return (
    <div className={cn("flex w-full flex-col items-stretch", typeof state === "object" && "serving" in state ? "h-full" : "min-h-full")}>
      {/* Only a served page takes the frame; every other state shows on the page, as the other views' states. */}
      {state === "starting" || held ? (
        <div className="p-6">
          <LoadingState text="Starting" />
        </div>
      ) : state === "failed" ? (
        <div className="p-6">
          <EmptyState glyph="preview" title="Not running" text="The machine failed to start. Send a message to try again; the preview follows." />
        </div>
      ) : "serving" in state ? (
        <>
          <div className="relative flex items-center gap-2 px-4 py-2.5">
            <div className="min-w-0 flex-1" style={{ maxWidth: 640 }}>
              <FieldBox value={state.serving} mono glyph="globe" size="small" />
            </div>
            <span className="w-2 shrink-0" />
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {reload && <IconButton glyph="reload" label="Reload" onClick={reload} />}
              <Button size="small" glyph="external" onClick={() => open?.(state.serving)}>
                Open in the browser
              </Button>
            </div>
            <Rule className="absolute right-0 bottom-0 left-0" />
          </div>
          <div className="flex min-h-0 flex-1">
            {frame ?? <WebFrame flush state={{ running: state.serving }} />}
          </div>
        </>
      ) : "stopped" in state ? (
        <div className="flex flex-col items-center gap-4 p-6">
          {state.stopped && (
            <div className="w-full" style={{ maxWidth: measure.page }}>
              <Notice text={state.stopped} tone="red" />
            </div>
          )}
          <EmptyState
            glyph="preview"
            title="Preview not running"
            text={`Starting it brings up the machine when it is down, then runs ${sentence(commands)}.`}
            action={
              <Button kind="primary" size="small" glyph="play" onClick={start}>
                Start preview
              </Button>
            }
          />
        </div>
      ) : (
        <div className="p-6">
          <EmptyState glyph="preview" title="No preview" text={state.unavailable} />
        </div>
      )}
    </div>
  );
}

export type FilesPaneState =
  | "loading"
  // The machine is starting; the files show once its branch is up.
  | { starting: string | null }
  // The machine is down.
  | "stopped"
  | { failed: string }
  // The paths, how the branch changed some of them, and the full count when the list is cut.
  | { paths: string[]; changes?: Record<string, FileChange>; total?: number };

export type FilesPaneFile =
  | "none"
  | "loading"
  | { failed: string }
  // A file read as text, with its size line.
  | { path: string; detail?: string; text: string }
  // A file that is not shown, with the reason.
  | { path: string; hidden: string };

// A checkout's files: a searchable tree marking what the branch changed, and the file open beside it. A machine
// that is down says how to start it. `query` filters the tree on arrival. `open` reads a path, `reload` the tree,
// `start` brings the machine up.
export function FilesPane({ state, file = "none", query: initial = "", open, reload, start }: {
  state: FilesPaneState; file?: FilesPaneFile; query?: string; open?: (path: string) => void; reload?: () => void; start?: () => void;
}) {
  const [query, setQuery] = useState(initial);
  // The path last asked for, read again when it failed.
  const [asked, setAsked] = useState<string>();
  // A state body: the pane's height, or its content's when taller.
  const top = "flex min-h-full w-full flex-col items-stretch";
  const held = useDelayedBusy(state === "loading", hasFailed(state));
  const fileHeld = useDelayedBusy(file === "loading", hasFailed(file));
  if (state === "loading" || held) {
    return (
      <div className={top}>
        <LoadingState text="Reading the checkout" />
      </div>
    );
  }
  if (state === "stopped") {
    return (
      <div className={top}>
        <EmptyState
          glyph="file"
          title="Machine not running"
          text="The files are read on the machine. Starting it brings it up with the checkout as it was left."
          action={
            <Button kind="primary" size="small" glyph="play" onClick={start}>
              Start
            </Button>
          }
        />
      </div>
    );
  }
  if ("starting" in state) {
    return (
      <div className={top}>
        <EmptyState
          glyph="file"
          title="Machine starting"
          text={`The files show once ${state.starting ?? "the branch"} is up.`}
          action={
            <Button size="small" glyph="file" onClick={reload}>
              Show files
            </Button>
          }
        />
      </div>
    );
  }
  if ("failed" in state) {
    return (
      <div className={top}>
        <ErrorState title="Files did not load" message={state.failed} retry={reload} />
      </div>
    );
  }
  if (state.paths.length === 0) {
    return (
      <div className={top}>
        <EmptyState glyph="file" title="No files yet" text="The checkout holds no files. What the agent writes shows here." />
      </div>
    );
  }
  const q = query.toLowerCase();
  const shown = state.paths.filter((p) => !q || p.toLowerCase().includes(q));
  const openPath = typeof file === "object" && "path" in file ? file.path : undefined;
  return (
    <div className="flex h-full w-full items-stretch">
      <Surface preset="page" className="relative w-[320px] shrink-0" strips={<SearchField placeholder="Search files" value={query} onChange={setQuery} />} scroll={false}>
        <div className="relative min-h-0 flex-1">
          <PathTree
            paths={state.paths}
            changes={state.changes}
            query={query}
            selected={openPath}
            open={(path) => {
              setAsked(path);
              open?.(path);
            }}
          />
          {shown.length === 0 && (
            <div className="absolute inset-0 bg-page">
              <EmptyState
                text={`No file matches “${query}”.`}
                action={
                  <Button size="small" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            </div>
          )}
        </div>
        {state.total !== undefined && (
          <div className="p-3">
            <Notice text={`Showing ${state.paths.length} of ${state.total} paths.`} tone="grey" />
          </div>
        )}
        <Rule vertical className="absolute top-0 right-0 bottom-0" />
      </Surface>
      <div className="flex min-w-0 flex-1 flex-col items-stretch">
        {file === "none" ? (
          <EmptyState glyph="file" title="No file open" text="Pick a file in the tree to read it here." />
        ) : file === "loading" || fileHeld ? (
          <LoadingState text="Reading the file" />
        ) : "failed" in file ? (
          <ErrorState title="File not shown" message={file.failed} retry={() => asked && open?.(asked)} />
        ) : "hidden" in file ? (
          <EmptyState glyph="file" title="File not shown" text={file.hidden} />
        ) : (
          <FileViewer path={file.path} detail={file.detail} text={file.text} />
        )}
      </div>
    </div>
  );
}

// One file of the patch.
export type ChangesFile = { path: string; added?: number; removed?: number; lines?: DiffLine[] };

export type ChangesPaneState =
  | "loading"
  | { failed: string }
  // No file differs: the title and the line.
  | { empty: [string, string] }
  | { files: ChangesFile[] };

// A checkout's patch, file by file: counts, a filter, unified or split. `query` filters the files on arrival;
// `retry` reads the patch again after it failed.
export function ChangesPane({ state, query: initial = "", retry }: { state: ChangesPaneState; query?: string; retry?: () => void }) {
  const [layout, setLayout] = useState(0);
  const [query, setQuery] = useState(initial);
  // A state body: the pane's height, or its content's when taller.
  const top = "flex min-h-full w-full flex-col items-stretch";
  const held = useDelayedBusy(state === "loading", hasFailed(state));
  if (state === "loading" || held) {
    return (
      <div className={top}>
        <LoadingState text="Reading the changes" />
      </div>
    );
  }
  if ("failed" in state) {
    return (
      <div className={top}>
        <ErrorState title="The changes did not load" message={state.failed} retry={retry} />
      </div>
    );
  }
  if ("empty" in state) {
    return (
      <div className={top}>
        <EmptyState glyph="changes" title={state.empty[0]} text={state.empty[1]} />
      </div>
    );
  }
  const files = state.files;
  const q = query.toLowerCase();
  const shown = files.filter((f) => !q || f.path.toLowerCase().includes(q));
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0);
  return (
    <div className={top}>
      {/* The bar's edges are the blocks' edges: the summary starts and the controls end where the blocks do. */}
      <div className="relative flex h-11 shrink-0 justify-center px-6">
        <div className="flex w-full items-center gap-2" style={{ maxWidth: measure.code + 32 }}>
          <span className="text-[13px] leading-[18px] text-secondary">
            {files.length === 1 ? "1 file" : `${files.length} files`} · +{added} −{removed}
          </span>
          <span className="flex-1" />
          <div className="w-[280px] min-w-0">
            <SearchField placeholder="Filter changed files" value={query} onChange={setQuery} />
          </div>
          <Segments items={["Unified", "Split"]} selection={layout} onChange={setLayout} />
        </div>
        <Rule className="absolute right-0 bottom-0 left-0" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full flex-col items-stretch gap-4 px-6 py-6" style={{ maxWidth: measure.code + 32 + 48 }}>
          {shown.length === 0 && (
            <EmptyState
              text={`No changed file matches “${query}”.`}
              action={
                <Button size="small" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          )}
          {shown.map((f, i) => (
            <DiffBlock key={i} file={f.path} added={f.added ?? 0} removed={f.removed ?? 0} lines={f.lines ?? []} layout={layout === 1 ? "split" : "unified"} />
          ))}
        </div>
      </div>
    </div>
  );
}

export type TerminalPaneState =
  | "connecting"
  | { failed: string }
  // The shell over its socket.
  | { live: LiveTerminalStatus }
  // The machine cannot start, with the reason.
  | { refused: string }
  // Opening the terminal starts a stopped machine.
  | "starting";

// A machine's terminal: connecting, the live shell, why it cannot start, or the machine starting. `lines` is what
// the shell printed, `input` a line typed, `reconnect` opens the socket again.
export function TerminalPane({ state, lines = [], prompt = "$", input, reconnect = () => {} }: {
  state: TerminalPaneState; lines?: TerminalLine[]; prompt?: string; input?: (line: string) => void; reconnect?: () => void;
}) {
  const held = useDelayedBusy(state === "starting", typeof state === "object" && ("failed" in state || "refused" in state));
  if (state === "connecting") return <LiveTerminal state="connecting" />;
  if (state === "starting" || held) {
    return (
      <div className="flex min-h-full w-full flex-col items-stretch">
        <LoadingState text="Starting the machine" />
      </div>
    );
  }
  if ("failed" in state) {
    return (
      <div className="flex min-h-full w-full flex-col items-stretch">
        <ErrorState title="The terminal did not open" message={state.failed} retry={reconnect} />
      </div>
    );
  }
  if ("refused" in state) return <LiveTerminal state={{ refused: state.refused }} />;
  return <LiveTerminal state={state.live} lines={lines} prompt={prompt} input={input} reconnect={reconnect} />;
}

// The tree's glyphs: Lucide at the glyph's size and stroke (see glyph.tsx).
const sprite = (() => {
  // The <svg>'s paint (no fill, a round stroke) moves to a group inside the symbol.
  const symbol = (id: string, svg: string) => {
    const open = svg.match(/<svg([^>]*)>/)?.[1] ?? "";
    const view = open.match(/viewBox="[^"]*"/)?.[0] ?? 'viewBox="0 0 24 24"';
    const paint = (open.match(/(fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"]*"/g) ?? []).join(" ");
    const body = svg.replace(/<svg[^>]*>/, "").replace("</svg>", "");
    return `<symbol id="${id}" ${view}><g ${paint}>${body}</g></symbol>`;
  };
  const file = renderToStaticMarkup(<File size={13.5} strokeWidth={1.3} absoluteStrokeWidth />);
  const chevron = renderToStaticMarkup(<ChevronDown size={10.5} strokeWidth={1.3} absoluteStrokeWidth />);
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbol("h0-file", file)}${symbol("h0-chevron", chevron)}</svg>`;
})();

const changeStatus: Record<FileChange, GitStatusEntry["status"]> = { added: "added", modified: "modified", deleted: "deleted" };

// The tree as a nav list (NavRow): 32 rows, a 13 glyph and 12.5 mono text, tertiary and secondary at rest, ink on the
// grey of the selected row, the quiet fill on hover, a change's letter on the right in its tone.
const treeStyle = {
  colorScheme: "light",
  "--trees-font-family-override": "var(--font-mono)",
  "--trees-font-size-override": "12.5px",
  "--trees-fg-override": palette.secondary,
  "--trees-fg-muted-override": palette.tertiary,
  "--trees-bg-override": palette.page,
  "--trees-bg-muted-override": palette.quiet,
  "--trees-selected-bg-override": palette.area,
  "--trees-selected-fg-override": palette.ink,
  "--trees-border-radius-override": "5px",
  "--trees-item-padding-x-override": "8px",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-row-gap-override": "8px",
  "--trees-icon-width-override": "13px",
  "--trees-level-gap-override": "7px",
  "--trees-padding-inline-override": "0px",
  "--trees-focus-ring-width-override": "0px",
  "--trees-indent-guide-bg-override": "transparent",
  "--trees-git-lane-width-override": "auto",
  "--trees-git-added-color-override": tone.green.ink,
  "--trees-git-modified-color-override": tone.orange.ink,
  "--trees-git-deleted-color-override": tone.red.ink,
  "--trees-font-weight-semibold-override": "500",
  "--trees-search-font-weight-override": "400",
} as CSSProperties;

// A change colours only its letter, as NavRow; the name and glyph keep their row's colours.
const treeCSS = `
  [data-item-git-status] > [data-item-section='content'] { color: inherit; }
  [data-item-git-status] > [data-item-section='icon'] > svg { color: var(--trees-fg-muted); }
  [data-item-selected='true'] > [data-item-section='icon'] > svg { color: var(--trees-selected-fg); }
  [data-item-section='git'] { font-size: 11.5px; margin-left: auto; }
  [data-item-section='icon'] svg { fill: none; }
  [data-item-contains-git-change='true'] > [data-item-section='git'] { display: none; }
`;

// A checkout's paths as a tree; picking a file reads it. `query` keeps the paths that match.
function PathTree({ paths, changes = {}, query, selected, open }: {
  paths: string[]; changes?: Record<string, FileChange>; query: string; selected?: string; open: (path: string) => void;
}) {
  const latest = useRef(open);
  latest.current = open;
  const git = Object.entries(changes).map(([path, change]) => ({ path, status: changeStatus[change] }));
  const { model } = useFileTree({
    paths,
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    itemHeight: 32,
    gitStatus: git,
    initialSelectedPaths: selected ? [selected] : [],
    fileTreeSearchMode: "hide-non-matches",
    icons: { set: "none", spriteSheet: sprite, remap: { "file-tree-icon-file": { name: "h0-file", width: 13.5, height: 13.5, viewBox: "0 0 24 24" }, "file-tree-icon-chevron": { name: "h0-chevron", width: 10.5, height: 10.5, viewBox: "0 0 24 24" } } },
    unsafeCSS: treeCSS,
    onSelectionChange: (chosen) => {
      const path = chosen[chosen.length - 1];
      if (path && !model.getItem(path)?.isDirectory()) latest.current(path);
    },
  });
  useEffect(() => model.resetPaths(paths), [model, paths.join("\n")]);
  useEffect(() => model.setGitStatus(git), [model, JSON.stringify(git)]);
  useEffect(() => {
    if (selected) model.getItem(selected)?.select();
  }, [model, selected]);
  // After the selection: picking a file clears the tree's search, and the field still shows it.
  useEffect(() => model.setSearch(query.trim() || null), [model, query, selected]);
  return <FileTree model={model} className="block h-full" style={treeStyle} />;
}
