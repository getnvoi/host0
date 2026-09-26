import type { LucideIcon, LucideProps } from "lucide-react";
import {
  AppWindow, Archive, ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, BookMarked, Bot, BotMessageSquare, Box, Check,
  ChevronDown, ChevronLeft, ChevronRight, Circle, Copy, CornerDownRight, Download, Ellipsis, EyeOff, FileCode, FileDiff,
  FileText, Gauge, GitBranch, Hand, House, Kanban, KeyRound, Layers, LayoutGrid, Library, Link, List, ListChecks, Lock,
  MessageSquare, MessagesSquare, Minus, Paperclip, Pencil, Pin, Play, Plug, Plus, RotateCcw, Search, Server,
  ShieldCheck, SlidersHorizontal, Sparkle, Sparkles, SquareCheck, SquareTerminal, StickyNote, Trash2, Upload, User,
  Wrench, X, Zap,
} from "lucide-react";
import { cx } from "./cx";

// vrcl's glyph names, drawn with lucide.
const ICONS: Record<string, LucideIcon> = {
  agent: Bot, archive: Archive, "arrow-down": ArrowDown, "arrow-left": ArrowLeft, "arrow-up": ArrowUp,
  "arrow-up-right": ArrowUpRight, artifact: FileText, board: Kanban, changes: FileDiff, chat: MessageSquare,
  check: Check, "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, close: X,
  connector: Plug, copy: Copy, diff: FileDiff, download: Download, env: Box, "first-child": CornerDownRight,
  gate: ShieldCheck, "git-branch": GitBranch, hidden: EyeOff, home: House, human: User, "human-handsup": Hand, layers: Layers,
  library: Library, link: Link, list: List, llm: Sparkles, lock: Lock, member: User, minus: Minus,
  "more-horizontal": Ellipsis, note: StickyNote, other: Circle, paperclip: Paperclip, pencil: Pencil, pin: Pin,
  plan: ListChecks, play: Play, plus: Plus, preview: AppWindow, repo: BookMarked, restore: RotateCcw, search: Search,
  secret: KeyRound, server: Server, session: MessagesSquare, skill: Sparkle, sliders: SlidersHorizontal, spec: FileCode,
  subagent: BotMessageSquare, task: SquareCheck, terminal: SquareTerminal, tier: Gauge, tool: Wrench, trash: Trash2,
  upload: Upload, window: AppWindow, workspace: LayoutGrid, zap: Zap,
};

// Ds::Glyph: an icon for an action or interface chrome, in the current colour. `name` is a vrcl glyph name or a
// lucide icon passed directly.
export function Glyph({ name, size = 16, className, ...rest }: { name: string | LucideIcon; size?: number } & Omit<LucideProps, "name" | "size">) {
  const Icon = typeof name === "string" ? (ICONS[name] ?? Circle) : name;
  return <Icon width={size} height={size} strokeWidth={1.75} aria-hidden className={cx("ds-glyph", className)} {...rest} />;
}
