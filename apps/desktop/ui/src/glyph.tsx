import {
  AppWindow, Archive, ArrowDown, ArrowLeft, Bold, Heading2, Italic, ListOrdered, Minus, Quote, SquareCode, Strikethrough, Underline, ArrowDownToLine, ArrowUp, ArrowUpRight, Asterisk, AtSign, ChartColumn, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleSlash, Clock, ClockArrowDown, CornerDownRight, Columns3, Copy, Cpu, CreditCard, Diff, Ellipsis, EllipsisVertical, File,
  FileText, FileUp, Folder, GripVertical, GitBranch, Globe, Hand, House, Image, Inbox, Info, Key, KeyRound, Layers2, Link, List, Lock, LogOut, Maximize2,
  Menu, MessageCircleQuestionMark, MessagesSquare, Mic, Minimize2, Palette, PanelLeft, Paperclip, Pencil, Pin, Play, Reply, RotateCw, ScanLine, Search, Send, Server,
  Moon, Settings, Sparkles, Square, SquareArrowOutUpRight, Sun, SquarePlay, SquareTerminal, Terminal, Trash, Undo2, Unlink, Users,
  Variable, Workflow, Wrench, X, createLucideIcon, type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

// Lucide's plus as one path: its two strokes drawn apart leave a seam where they cross between pixels.
const Plus = createLucideIcon("plus", [["path", { d: "M5 12h14M12 5v14", key: "plus" }]]);

// GitHub's mark in Lucide's strokes: Lucide 1 ships no brand icons.
const Github = createLucideIcon("github", [
  ["path", { d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4", key: "mark" }],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "tail" }],
]);

// Interface glyphs under the names the components use.
export const glyphs: Record<string, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  heading: Heading2,
  bullets: List,
  numbers: ListOrdered,
  quote: Quote,
  codeBlock: SquareCode,
  rule: Minus,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  seeAll: CornerDownRight,
  home: House,
  moreVertical: EllipsisVertical,
  pin: Pin,
  file: File,
  terminal: SquareTerminal,
  branch: GitBranch,
  repo: Folder,
  bot: Cpu,
  arrowUp: ArrowUp,
  arrowUpRight: ArrowUpRight,
  check: Check,
  search: Search,
  back: ChevronLeft,
  arrowLeft: ArrowLeft,
  arrowDown: ArrowDown,
  gear: Settings,
  theme: Palette,
  sun: Sun,
  moon: Moon,
  people: Users,
  signOut: LogOut,
  plus: Plus,
  close: X,
  more: Ellipsis,
  task: List,
  clip: Paperclip,
  image: Image,
  upload: FileUp,
  lock: Lock,
  chart: ChartColumn,
  card: CreditCard,
  globe: Globe,
  agent: Asterisk,
  session: MessagesSquare,
  mic: Mic,
  menu: Menu,
  forward: ChevronRight,
  reply: Reply,
  question: MessageCircleQuestionMark,
  send: Send,
  reload: RotateCw,
  sparkle: Sparkles,
  rename: Pencil,
  restore: Undo2,
  copy: Copy,
  retry: RotateCw,
  inbox: Inbox,
  board: Columns3,
  gate: Hand,
  trash: Trash,
  setup: Wrench,
  preview: SquarePlay,
  play: Play,
  changes: Diff,
  run: Terminal,
  key: Key,
  server: Server,
  github: Github,
  link: Link,
  unlink: Unlink,
  expand: Maximize2,
  collapse: Minimize2,
  artifact: FileText,
  deck: Layers2,
  app: AppWindow,
  external: SquareArrowOutUpRight,
  download: ArrowDownToLine,
  archive: Archive,
  doc: File,
  activity: ClockArrowDown,
  clock: Clock,
  info: Info,
  stop: Square,
  workflow: Workflow,
  capture: ScanLine,
  command: CircleSlash,
  at: AtSign,
  grip: GripVertical,
  env: Variable,
  secret: KeyRound,
  sidebar: PanelLeft,
};

// Glyphs drawn filled.
const filled = new Set(["play", "stop"]);

export type GlyphProps = {
  name: string;
  size?: number;
  // A colour; omitted, the glyph takes the text colour around it.
  color?: string;
  // The weight: under 1.5 regular, under 1.8 medium, else bold.
  width?: number;
  className?: string;
};

// An interface glyph in a square box of `size`.
// Lucide's chevrons and x keep about 3 of white on their right at 12 to 13: a glyph that ends a row takes it back with
// this, so its stroke ends on the row's inset.
export const glyphTrim = "-mr-[3px]";

export function Glyph({ name, size = 14, color = "var(--color-tertiary)", width = 1.5, className }: GlyphProps) {
  const Icon = glyphs[name] ?? Square;
  // Lucide draws on a 24 grid with a 2 inset; the glyph is scaled to fill about 90% of the box.
  const drawn = Math.round(size * 1.05 * 2) / 2;
  // The stroke grows with the size; each weight is a share of it.
  const stroke = Math.max(0.75, size * (width >= 1.8 ? 0.13 : width >= 1.5 ? 0.1 : 0.085));
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size, color }}
    >
      <Icon
        size={drawn}
        strokeWidth={stroke}
        absoluteStrokeWidth
        fill={filled.has(name) ? "currentColor" : "none"}
      />
    </span>
  );
}

// A glyph that turns with what it opens: by `by` degrees while `open`, or, as a `menu` chevron, half a turn while the
// dropdown around it is open. The timing is the design system's (`.turn`), never a screen's.
export function Turn({ open, by = 90, menu, className, children }: { open?: boolean; by?: number; menu?: boolean; className?: string; children: ReactNode }) {
  return (
    <span data-menu={menu || undefined} className={cn("turn flex", className)} style={open ? { transform: `rotate(${by}deg)` } : undefined}>
      {children}
    </span>
  );
}

// How long a copy button shows its check before it returns, the same for every copy button.
export const copiedFor = 1500;

// The copy glyph that turns into a check once copied: the copy shrinks and fades as the check grows in and draws
// itself.
export function CopyGlyph({ copied, size = 14, ...glyph }: Omit<GlyphProps, "name" | "className"> & { copied: boolean }) {
  return (
    <span data-on={copied || undefined} className="inline-grid shrink-0" style={{ width: size, height: size }}>
      <span className="swap flex [grid-area:1/1]" style={{ opacity: copied ? 0 : 1, transform: copied ? "scale(0.5)" : undefined }}>
        <Glyph name="copy" size={size} {...glyph} />
      </span>
      <span className="swap flex [grid-area:1/1]" style={{ opacity: copied ? 1 : 0, transform: copied ? undefined : "scale(0.5)" }}>
        <Glyph name="check" size={size} className="draw" {...glyph} />
      </span>
    </span>
  );
}
