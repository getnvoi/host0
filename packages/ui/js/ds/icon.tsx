import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { AppWindow, ArrowLeft, BookMarked, Bot, BotMessageSquare, Box, Camera, Circle, FileDiff, FileSearch, FileText, GitPullRequest, KeyRound, Layers, LayoutGrid, Library, ListChecks, MessagesSquare, Pencil, Plug, Search, Server, ShieldCheck, Sparkle, Sparkles, SquareCheck, SquareTerminal, StickyNote, Type, Upload, User, Wrench, Zap } from "lucide-react";
import { cx } from "./cx";

// Ds::Icon: a category face, a pastel disc in the family's colour with the drawing on it. The drawing is lucide's.
export const FAMILY: Record<string, string> = {"session": "blue","agent": "blue","subagent": "blue","llm": "blue","skill": "blue","tool": "olive","read": "olive","edit": "olive","bash": "olive","grep": "olive","settitle": "olive","screenshot": "olive","push": "olive","pr": "olive","repo": "green","changes": "green","env": "orange","terminal": "orange","preview": "orange","layers": "orange","zap": "orange","server": "orange","library": "amber","note": "amber","artifact": "pink","you": "purple","member": "purple","workspace": "purple","task": "teal","plan": "teal","gate": "yellow","secret": "yellow","connector": "gray"};

export const LABELS: Record<string, string> = {"session": "Session","agent": "Agent","subagent": "Sub-agent","llm": "LLM","skill": "Skill","tool": "Tool","read": "Read","edit": "Edit","bash": "Bash","grep": "Grep","settitle": "Set title","screenshot": "Screenshot","push": "Push branch","pr": "Pull request","repo": "Repository","changes": "Changes","env": "Environment","terminal": "Terminal","preview": "Preview","layers": "Standard","zap": "Advanced","server": "Production","library": "Library","note": "Note","artifact": "Artifact","you": "You","member": "Members","workspace": "Workspace","task": "Task","plan": "Plan","gate": "Approval","secret": "Secret","connector": "Connector"};

const DRAWINGS: Record<string, LucideIcon> = { "agent": Bot, "artifact": FileText, "back": ArrowLeft, "bash": SquareTerminal, "changes": FileDiff, "connector": Plug, "edit": Pencil, "env": Box, "gate": ShieldCheck, "grep": Search, "layers": Layers, "library": Library, "llm": Sparkles, "member": User, "note": StickyNote, "plan": ListChecks, "pr": GitPullRequest, "preview": AppWindow, "push": Upload, "read": FileSearch, "repo": BookMarked, "screenshot": Camera, "secret": KeyRound, "server": Server, "session": MessagesSquare, "settitle": Type, "skill": Sparkle, "subagent": BotMessageSquare, "task": SquareCheck, "terminal": SquareTerminal, "tool": Wrench, "workspace": LayoutGrid, "you": User, "zap": Zap };

// The line thickens as the icon shrinks, as vrcl's does.
const WEIGHTS: Record<number, number> = { 16: 1.35, 18: 1.25, 20: 1.15, 24: 1, 28: 1, 32: 0.9, 48: 0.8, 64: 0.7 };

export function Icon({ name, family, size = 24, className, style }: {
  name: string | LucideIcon;
  family?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Drawing = typeof name === "string" ? (DRAWINGS[name] ?? Circle) : name;
  const fam = family ?? (typeof name === "string" ? FAMILY[name] : undefined) ?? "gray";
  const vars = { "--size": `${size}px`, "--w": WEIGHTS[size] ?? 1, ...style } as CSSProperties;
  return (
    <svg viewBox="0 0 24 24" className={cx("ds-icon", `ds-f-${fam}`, className)} style={vars} aria-hidden>
      <circle cx={12} cy={12} r={12} className="ds-icon-disc" />
      <Drawing x={6} y={6} width={12} height={12} stroke="var(--i)" strokeWidth={2.2 * (WEIGHTS[size] ?? 1)} />
    </svg>
  );
}
