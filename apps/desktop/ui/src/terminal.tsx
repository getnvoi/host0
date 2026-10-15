// A machine's shells in xterm.js: raw keys out, PTY bytes in, every escape sequence drawn as a terminal draws it.
// The component never calls the network: a `TerminalTransport` carries the bytes. Each shell's xterm lives in a
// registry keyed by the transport's key and the shell's id, so leaving the view and coming back keeps the screen,
// the scrollback and the socket; the transport's `disposed` event lets them go.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import { cn } from "./cn";
import { Clickable } from "./clickable";
import { Notice } from "./conversation";
import { Glyph } from "./glyph";
import { TextInput } from "./inputs";
import { Button, Dot, IconButton, Spinner } from "./primitives";
import { EmptyState, ErrorState } from "./start";
import { chart, measure, palette, tone, type Tone } from "./tokens";

export type TerminalSize = { cols: number; rows: number };

// A shell running on the machine, as `POST /terminal` lists it.
export type TerminalShell = { id: string; command: string };

// The machine's state, or one shell's. `connecting` with `retry`: the link dropped, the next try in that many
// seconds. `starting`: the machine is coming up. `closed`: the shell ended (`code`) or was let go.
export type TerminalState =
  | { kind: "connecting"; retry?: number }
  | { kind: "starting"; reason?: string }
  | { kind: "refused"; message: string }
  | { kind: "live" }
  | { kind: "closed"; reason: string; code?: number }
  | { kind: "error"; message: string };

// `replay`: the first frame after a connect, the shell's scrollback, which replaces what the screen shows.
// A state with no shell is the machine's.
export type TerminalEvent =
  | { type: "data"; shell: string; bytes: Uint8Array; replay?: boolean }
  | { type: "state"; shell?: string; state: TerminalState }
  | { type: "shells"; shells: TerminalShell[] }
  | { type: "disposed" };

// What carries a session's shells. `start` asks for the terminal (idempotent); `connect` opens a shell's socket
// and keeps it open, reconnecting on its own, until `close` or `kill`; `retry` tries again at once.
export interface TerminalTransport {
  readonly key: string;
  shells(): TerminalShell[];
  // The machine's state without a shell, else that shell's.
  state(shell?: string): TerminalState;
  start(): void;
  connect(shell: string, size: TerminalSize): void;
  send(shell: string, bytes: Uint8Array): void;
  resize(shell: string, size: TerminalSize): void;
  close(shell: string): void;
  kill(shell: string): Promise<void>;
  // A new shell's id, added to the list; it starts on the machine when connected.
  create(): string;
  retry(shell?: string): void;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
}

// Light: the tone inks for the normal colours, the dots for the bright ones; white and bright white are greys
// that stay readable on white.
export const terminalTheme: ITheme = {
  background: palette.page,
  foreground: palette.ink,
  cursor: palette.ink,
  cursorAccent: palette.page,
  selectionBackground: "rgba(11, 104, 203, 0.18)",
  selectionInactiveBackground: "rgba(28, 25, 23, 0.08)",
  scrollbarSliderBackground: "rgba(28, 25, 23, 0.12)",
  scrollbarSliderHoverBackground: "rgba(28, 25, 23, 0.2)",
  scrollbarSliderActiveBackground: "rgba(28, 25, 23, 0.28)",
  black: palette.ink,
  red: tone.red.ink,
  green: tone.green.ink,
  yellow: tone.yellow.ink,
  blue: tone.blue.ink,
  magenta: "#953ea3",
  cyan: "#0c7792",
  white: palette.tertiary,
  brightBlack: palette.secondary,
  brightRed: tone.red.dot,
  brightGreen: tone.green.dot,
  brightYellow: "#ab6400",
  brightBlue: tone.blue.dot,
  brightMagenta: "#ab4aba",
  brightCyan: "#00a2c7",
  brightWhite: palette.faint,
};

const font = '"JetBrains Mono", ui-monospace, monospace';
const sizes = { least: 10, normal: 13, most: 22 };
const fontKey = "hz.terminal.font";

function storedSize() {
  try {
    const n = Number(localStorage.getItem(fontKey));
    return n >= sizes.least && n <= sizes.most ? n : sizes.normal;
  } catch {
    return sizes.normal;
  }
}

let fontSize = sizes.normal;
let fontRead = false;
let fontsLoaded: Promise<unknown> | undefined;

// JetBrains Mono must be there before xterm measures a cell.
function fonts() {
  fontsLoaded ??= Promise.race([
    Promise.all([document.fonts.load(`13px ${font}`), document.fonts.load(`bold 13px ${font}`)]).catch(() => undefined),
    new Promise((done) => setTimeout(done, 1500)),
  ]);
  return fontsLoaded;
}

const encoder = new TextEncoder();

// One shell's screen: the xterm, the element it draws in (moved between containers, never re-created) and the
// addons it keeps.
type Screen = {
  shell: string;
  term: XTerm;
  host: HTMLDivElement;
  fit: FitAddon;
  search: SearchAddon;
  webgl?: WebglAddon;
  // The WebGL context was lost: the DOM renderer draws from then on.
  glLost: boolean;
  opened: boolean;
  connected: boolean;
  printed: boolean;
  title?: string;
  found: { index: number; count: number };
};

// A session's shells: their screens, the shell shown, and a version that changes with anything drawn around them.
class Room {
  screens = new Map<string, Screen>();
  active?: string;
  started = false;
  version = 0;
  private listeners = new Set<() => void>();
  private off: () => void;

  constructor(readonly transport: TerminalTransport) {
    this.off = transport.subscribe((event) => this.heard(event));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private heard(event: TerminalEvent) {
    if (event.type === "disposed") return this.dispose();
    if (event.type === "data") {
      const screen = this.screen(event.shell);
      if (event.replay) screen.term.reset();
      if (event.bytes.length) {
        screen.term.write(event.bytes);
        if (!screen.printed) {
          screen.printed = true;
          this.bump();
        }
      }
      return;
    }
    this.settle();
    this.bump();
  }

  // A running machine with no shell gets one, once: a shell that exits at once is not started again on its own.
  settle() {
    const shells = this.transport.shells();
    if (shells.length) this.started = true;
    if (!this.started && this.transport.state().kind === "live") {
      this.started = true;
      this.active = this.transport.create();
    }
    for (const id of [...this.screens.keys()]) {
      if (!shells.some((s) => s.id === id)) this.drop(id);
    }
    if (!shells.some((s) => s.id === this.active)) this.active = shells[0]?.id;
  }

  screen(shell: string): Screen {
    const known = this.screens.get(shell);
    if (known) return known;
    const term = new XTerm({
      fontFamily: font,
      fontSize,
      lineHeight: 1.25,
      letterSpacing: 0,
      fontWeight: 400,
      fontWeightBold: 600,
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      scrollback: 10_000,
      smoothScrollDuration: 0,
      allowProposedApi: true,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
      drawBoldTextInBrightColors: false,
      minimumContrastRatio: 3,
      rescaleOverlappingGlyphs: true,
      theme: terminalTheme,
    });
    const host = document.createElement("div");
    host.className = "h-full w-full";
    const fit = new FitAddon();
    const search = new SearchAddon({ highlightLimit: 2000 });
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new ClipboardAddon());
    const screen: Screen = { shell, term, host, fit, search, glLost: false, opened: false, connected: false, printed: false, found: { index: -1, count: 0 } };
    term.loadAddon(new WebLinksAddon((event, uri) => event.metaKey && this.link?.(uri)));
    term.onData((data) => this.type(screen, encoder.encode(data), data));
    term.onBinary((data) => this.type(screen, Uint8Array.from(data, (c) => c.charCodeAt(0) & 255), data));
    term.onResize((size) => this.transport.resize(shell, size));
    term.onTitleChange((title) => {
      screen.title = title.trim() || undefined;
      this.bump();
    });
    search.onDidChangeResults(({ resultIndex, resultCount }) => {
      screen.found = { index: resultIndex, count: resultCount };
      this.bump();
    });
    term.attachCustomKeyEventHandler((event) => this.key(screen, event));
    this.screens.set(shell, screen);
    return screen;
  }

  // Opens links ⌘-clicked in the output; set by the component.
  link?: (url: string) => void;
  // Asks the component to show the search bar.
  find?: () => void;

  // Keys go to the shell while it is live; a shell that ended starts again on Return.
  private type(screen: Screen, bytes: Uint8Array, data: string) {
    const state = this.transport.state(screen.shell);
    if (this.transport.state().kind === "live" && state.kind === "closed") {
      if (data === "\r") this.transport.retry(screen.shell);
      return;
    }
    this.transport.send(screen.shell, bytes);
  }

  // ⌘K clears, ⌘F finds, ⌘+ ⌘- ⌘0 size the font; the app's own shortcuts never see these while the shell has the
  // keys. Everything else is xterm's.
  private key(screen: Screen, event: KeyboardEvent) {
    if (!event.metaKey || event.ctrlKey || event.altKey) return true;
    const key = event.key.toLowerCase();
    const mine = key === "k" || key === "f" || key === "=" || key === "+" || key === "-" || key === "0";
    if (!mine) return true;
    if (event.type === "keydown") {
      event.preventDefault();
      event.stopPropagation();
      if (key === "k") screen.term.clear();
      else if (key === "f") this.find?.();
      else setFontSize(key === "0" ? sizes.normal : fontSize + (key === "-" ? -1 : 1));
    }
    return false;
  }

  // The screen into a container: drawn by WebGL while shown, by the DOM when the context is lost.
  attach(screen: Screen, container: HTMLElement) {
    if (!screen.opened) {
      screen.term.open(screen.host);
      screen.opened = true;
    }
    if (screen.host.parentElement !== container) container.appendChild(screen.host);
    if (!screen.webgl && !screen.glLost) {
      try {
        const gl = new WebglAddon();
        gl.onContextLoss(() => {
          screen.glLost = true;
          screen.webgl = undefined;
          gl.dispose();
        });
        screen.term.loadAddon(gl);
        screen.webgl = gl;
      } catch {
        screen.glLost = true;
      }
    }
    fitScreen(screen);
  }

  // Off the page the context goes back: a browser keeps only a few.
  detach(screen: Screen) {
    screen.webgl?.dispose();
    screen.webgl = undefined;
    screen.host.remove();
  }

  drop(shell: string) {
    const screen = this.screens.get(shell);
    if (!screen) return;
    this.screens.delete(shell);
    screen.webgl?.dispose();
    screen.term.dispose();
    screen.host.remove();
  }

  dispose() {
    this.off();
    for (const id of [...this.screens.keys()]) this.drop(id);
    if (rooms.get(this.transport.key) === this) rooms.delete(this.transport.key);
    this.bump();
  }
}

const rooms = new Map<string, Room>();

function roomFor(transport: TerminalTransport) {
  const known = rooms.get(transport.key);
  if (known && known.transport === transport) return known;
  known?.dispose();
  const room = new Room(transport);
  rooms.set(transport.key, room);
  room.settle();
  return room;
}

// Resizes the grid to its container; the transport hears only a change of columns or rows.
function fitScreen(screen: Screen) {
  const host = screen.host;
  if (!screen.opened || !host.isConnected || host.clientWidth < 20 || host.clientHeight < 10) return;
  const proposed = screen.fit.proposeDimensions();
  if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
  const cols = Math.max(2, proposed.cols);
  const rows = Math.max(1, proposed.rows);
  if (cols !== screen.term.cols || rows !== screen.term.rows) screen.term.resize(cols, rows);
}

function setFontSize(next: number) {
  fontSize = Math.min(sizes.most, Math.max(sizes.least, next));
  try {
    localStorage.setItem(fontKey, String(fontSize));
  } catch {
    // Kept for this launch only.
  }
  for (const room of rooms.values()) {
    for (const screen of room.screens.values()) {
      screen.term.options.fontSize = fontSize;
      fitScreen(screen);
    }
  }
}

// The shell's name in its tab: what it set as its title, else its command; the second and later get a number.
function shellName(shell: TerminalShell, index: number, title?: string) {
  if (title) return title;
  const command = shell.command.split("/").pop()?.split(" ")[0] || "shell";
  return index > 0 ? `${command} ${index + 1}` : command;
}

const stateWord = (s: TerminalState): [string, Tone] => {
  switch (s.kind) {
    case "connecting":
      return [s.retry !== undefined ? "Reconnecting" : "Connecting", "blue"];
    case "starting":
      return ["Starting the machine", "orange"];
    case "refused":
      return ["Not started", "red"];
    case "live":
      return ["Connected", "green"];
    case "closed":
      return [s.code !== undefined ? "Exited" : "Disconnected", "grey"];
    case "error":
      return ["Failed", "red"];
  }
};

export type TerminalProps = {
  transport: TerminalTransport;
  // Opens a link ⌘-clicked in the output.
  open?: (url: string) => void;
  className?: string;
};

// A machine's terminal: the shells in tabs with New shell, the screen of the shell chosen, and what keeps it from
// being live drawn over it. Keys, paste (bracketed when the program asks), selection and copy, colours, the
// cursor and the alternate screen are xterm's; ⌘K clears, ⌘F finds, ⌘+ and ⌘- size the font, ⌘0 resets it.
export function Terminal({ transport, open, className }: TerminalProps) {
  const room = roomFor(transport);
  useSyncExternalStore(room.subscribe, () => room.version);
  const container = useRef<HTMLDivElement>(null);
  // How many times find was asked for: the bar opens on the first, selects its query on the next.
  const [finding, setFinding] = useState(0);
  const [failure, setFailure] = useState<string>();
  const [ready, setReady] = useState(false);

  if (!fontRead) {
    fontRead = true;
    fontSize = storedSize();
  }

  room.link = (url) => (open ? open(url) : window.open(url, "_blank", "noopener"));
  room.find = () => setFinding((n) => n + 1);

  useEffect(() => {
    transport.start();
    let gone = false;
    void fonts().then(() => !gone && setReady(true));
    return () => {
      gone = true;
    };
  }, [transport]);

  const shells = transport.shells();
  const machine = transport.state();
  const active = room.active && shells.some((s) => s.id === room.active) ? room.active : undefined;
  const screen = active ? room.screen(active) : undefined;
  const state = machine.kind === "live" && active ? transport.state(active) : machine;

  // The chosen shell's screen in the container, fitted, connected once; the screen leaves with the view.
  useLayoutEffect(() => {
    const el = container.current;
    if (!ready || !el || !screen) return;
    room.attach(screen, el);
    if (!screen.connected && machine.kind === "live") {
      screen.connected = true;
      transport.connect(screen.shell, { cols: screen.term.cols, rows: screen.term.rows });
    }
    return () => room.detach(screen);
  }, [ready, screen, machine.kind, room, transport]);

  // Focus follows the shell shown, and a shell coming live.
  useEffect(() => {
    if (ready && screen && state.kind === "live" && !finding) screen.term.focus();
  }, [ready, screen, state.kind, finding]);

  // Refitted when the container changes size, at most once a frame and after the size settles.
  useEffect(() => {
    const el = container.current;
    if (!el || !screen) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = requestAnimationFrame(() => fitScreen(screen));
      timer = setTimeout(() => fitScreen(screen), 80);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [screen]);

  useEffect(() => {
    if (!failure) return;
    const timer = setTimeout(() => setFailure(undefined), 5000);
    return () => clearTimeout(timer);
  }, [failure]);

  const choose = (id: string) => {
    room.active = id;
    room.bump();
  };
  const add = () => {
    room.started = true;
    choose(transport.create());
  };
  const remove = (id: string) => {
    const at = shells.findIndex((s) => s.id === id);
    if (room.active === id) room.active = shells[at + 1]?.id ?? shells[at - 1]?.id;
    room.bump();
    transport.kill(id).catch((error: unknown) => setFailure(error instanceof Error ? error.message : "The shell could not be closed."));
  };
  const retry = () => transport.retry(machine.kind === "live" ? active : undefined);

  const [word, wordTone] = stateWord(state);
  const empty = machine.kind === "live" && shells.length === 0;
  // A screen that already shows output keeps it under a banner; one with nothing yet is covered.
  const kept = !!screen?.printed;
  const banner = (state.kind === "connecting" && state.retry !== undefined && kept) || state.kind === "closed";
  const cover = !empty && !banner && state.kind !== "live" && !(state.kind === "connecting" && kept);

  return (
    <div data-testid="terminal" className={cn("flex h-full w-full min-w-0 flex-col bg-white", className)}>
      <div className="relative flex h-11 shrink-0 items-center gap-1 px-2">
        <div role="tablist" aria-label="Shells" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
          {shells.map((shell, i) => (
            <ShellTab
              key={shell.id}
              name={shellName(shell, i, room.screens.get(shell.id)?.title)}
              state={machine.kind === "live" ? transport.state(shell.id) : machine}
              selected={shell.id === active}
              choose={() => choose(shell.id)}
              close={() => remove(shell.id)}
            />
          ))}
        </div>
        {machine.kind === "live" && <IconButton glyph="plus" label="New shell" onClick={add} />}
        <span className="min-w-4 flex-1" />
        {failure && <span className="truncate pr-2 text-[13px] text-red-ink">{failure}</span>}
        <span className="flex shrink-0 items-center gap-2 pr-1">
          <Dot tone={wordTone} />
          <span className="text-[13px] text-secondary">{word}</span>
        </span>
        <IconButton glyph="search" label="Find" disabled={!screen?.opened} onClick={() => setFinding((n) => n + 1)} />
        <span className="absolute right-0 bottom-0 left-0 h-px bg-line" />
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={container} className={cn("absolute inset-0 py-2 pr-1 pl-3", (cover || empty) && "invisible")} />
        {finding > 0 && screen && <FindBar screen={screen} asked={finding} close={() => setFinding(0)} />}
        {banner && <TerminalBanner state={state} retry={retry} />}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState
              glyph="terminal"
              title="No shell open"
              text="Shells run on the session's machine and keep running when you leave."
              action={
                <Button size="small" glyph="plus" onClick={add}>
                  New shell
                </Button>
              }
            />
          </div>
        )}
        {cover && <TerminalCover state={state} retry={retry} />}
      </div>
    </div>
  );
}

// A shell's tab: its state's dot, its name, and a close button shown on hover and on the chosen tab.
function ShellTab({ name, state, selected, choose, close }: { name: string; state: TerminalState; selected: boolean; choose: () => void; close: () => void }) {
  const [, t] = stateWord(state);
  return (
    <Clickable
      role="tab"
      fill={selected ? "clear" : undefined}
      onClick={choose}
      label={name}
      handle={`shell:${name}`}
      chosen={selected}
      className={cn("group flex h-7 min-w-0 shrink items-center gap-2 rounded-control pr-1 pl-2.5", selected && "bg-area")}
    >
      <Dot tone={t} />
      <span className={cn("max-w-44 truncate font-mono text-[12.5px]", selected ? "text-ink" : "text-secondary")}>{name}</span>
      <Clickable
        fill={selected ? palette.pressed : palette.area}
        radius={3}
        onClick={close}
        label={`Close ${name}`}
        handle={`button:Close ${name}`}
        className={cn("flex size-[18px] shrink-0 items-center justify-center", !selected && "opacity-0 group-hover:opacity-100")}
      >
        <Glyph name="close" size={10} color={palette.tertiary} width={1.8} />
      </Clickable>
    </Clickable>
  );
}

// What hides a screen with nothing to show yet: connecting, the machine starting, refused, failed.
function TerminalCover({ state, retry }: { state: TerminalState; retry: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-white px-6">
      {state.kind === "refused" ? (
        <div className="w-full" style={{ maxWidth: measure.conversation }}>
          <Notice text={state.message} tone="red" title="The machine was not started" action="Try again" perform={retry} />
        </div>
      ) : state.kind === "error" ? (
        <ErrorState title="The terminal did not open" message={state.message} retry={retry} />
      ) : (
        <div className="flex flex-col items-center gap-2.5">
          <Spinner size={18} />
          <span className="text-[13px] text-tertiary">{state.kind === "starting" ? "Starting the machine" : "Connecting"}</span>
          {state.kind === "starting" && state.reason && <span className="max-w-[360px] text-center text-[13px] text-secondary">{state.reason}</span>}
        </div>
      )}
    </div>
  );
}

// Over a screen that keeps its output: the link retrying, or the shell ended, with the way back.
function TerminalBanner({ state, retry }: { state: TerminalState; retry: () => void }) {
  const closed = state.kind === "closed";
  const text = closed ? state.reason : state.kind === "connecting" && state.retry ? `Connection lost. Trying again in ${state.retry}s` : "Connection lost. Trying again";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div
        data-testid={closed ? "terminal:closed" : "terminal:reconnecting"}
        className="pointer-events-auto flex h-12 max-w-full items-center gap-2.5 rounded-panel bg-white pr-2 pl-3.5"
        style={{ boxShadow: floating }}
      >
        {closed ? <Dot tone="grey" /> : <Spinner size={13} />}
        <span className="truncate text-[13px] text-ink">{text}</span>
        {closed && <span className="shrink-0 text-[13px] text-tertiary">Return to start it again</span>}
        <span className="w-1 shrink-0" />
        <Button size="small" glyph="retry" onClick={retry}>
          {closed ? "Reconnect" : "Retry now"}
        </Button>
      </div>
    </div>
  );
}

// A panel floating over the screen, drawn as menus are.
const floating = "var(--shadow-menu)";

const findDecorations = {
  matchBackground: chart[3],
  matchOverviewRuler: chart[2],
  activeMatchBackground: chart[2],
  activeMatchBorder: tone.blue.ink,
  activeMatchColorOverviewRuler: tone.blue.ink,
};

// ⌘F: the query, the match shown of how many, previous and next. Return finds the next, ⇧Return the previous,
// Esc closes and gives the keys back to the shell.
function FindBar({ screen, asked, close }: { screen: Screen; asked: number; close: () => void }) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const options = { decorations: findDecorations, caseSensitive: false };
  const next = () => query && screen.search.findNext(query, options);
  const previous = () => query && screen.search.findPrevious(query, options);
  const done = () => {
    screen.search.clearDecorations();
    screen.term.clearSelection();
    close();
    screen.term.focus();
  };

  // ⌘F again selects the query.
  useEffect(() => {
    const input = box.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [asked]);

  const change = (value: string) => {
    setQuery(value);
    if (value) screen.search.findNext(value, { ...options, incremental: true });
    else {
      screen.search.clearDecorations();
      screen.found = { index: -1, count: 0 };
    }
  };

  const keys = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      done();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) previous();
      else next();
    } else if (event.metaKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      box.current?.querySelector("input")?.select();
    }
  };

  const { index, count } = screen.found;
  const counted = !query ? "" : count === 0 ? "No results" : index < 0 ? `${count}+` : `${index + 1} of ${count}`;
  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-panel bg-white p-1.5" style={{ boxShadow: floating }}>
      <div ref={box} onKeyDownCapture={keys} className="w-[220px]">
        <TextInput placeholder="Find" value={query} onChange={change} glyph="search" size="small" />
      </div>
      <span className="w-[76px] shrink-0 text-center text-[12.5px] text-tertiary tabular-nums">{counted}</span>
      <span className="inline-flex rotate-180">
        <IconButton glyph="chevronDown" label="Previous match" disabled={!count} onClick={previous} />
      </span>
      <IconButton glyph="chevronDown" label="Next match" disabled={!count} onClick={next} />
      <IconButton glyph="close" label="Close find" onClick={done} />
    </div>
  );
}
