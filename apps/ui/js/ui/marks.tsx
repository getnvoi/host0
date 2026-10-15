import type { LucideIcon } from "lucide-react";
import {
  Bot,
  BotMessageSquare,
  Compass,
  Box,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  Globe,
  GitPullRequest,
  ListTodo,
  Search,
  SquareTerminal,
  Tag,
  Upload,
  Wrench,
} from "lucide-react";
import { useTranslations } from "@/contexts/i18n";
import type { State } from "@/contexts/api/types";

export type Family = "blue" | "olive" | "green" | "orange" | "pink" | "purple" | "yellow" | "gray";

export function Face({ icon: Icon, family, size, label }: { icon: LucideIcon; family: Family; size?: 20 | 28 | 44; label?: string }) {
  return (
    <span className={`face fam-${family}${size ? ` s${size}` : ""}`} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined}>
      <Icon />
    </span>
  );
}

export function Tile({ name, size }: { name: string; size?: 20 }) {
  return (
    <span className={`tile${size ? ` s${size}` : ""}`} aria-hidden>
      {name.replace(/^.*\//, "").slice(0, 1) || "?"}
    </span>
  );
}

export type Tone = "ok" | "busy" | "bad" | "idle";

const TONE: Record<State, Tone> = { forking: "busy", running: "busy", awaiting_approval: "busy", idle: "ok", failed: "bad" };

export function tone(state: State): Tone {
  return TONE[state];
}

export function Dot({ tone, label, breath }: { tone: Tone; label?: string; breath?: boolean }) {
  return <span className={`dot ${tone}${breath ? " breath" : ""}`} title={label} aria-label={label} role={label ? "img" : undefined} />;
}

export function StateDot({ state }: { state: State }) {
  const { t } = useTranslations();
  return <Dot tone={tone(state)} label={t(`state.${state}`)} />;
}

const TOOLS: Record<string, { icon: LucideIcon; label?: string }> = {
  Bash: { icon: SquareTerminal },
  Read: { icon: FileText },
  Edit: { icon: FilePen },
  MultiEdit: { icon: FilePen },
  Write: { icon: FilePlus },
  NotebookEdit: { icon: FilePen },
  Grep: { icon: Search },
  Glob: { icon: FileSearch },
  WebFetch: { icon: Globe },
  WebSearch: { icon: Globe },
  TodoWrite: { icon: ListTodo },
  Task: { icon: BotMessageSquare },
  Agent: { icon: BotMessageSquare },
  SendMessage: { icon: BotMessageSquare },
  session_title: { icon: Tag, label: "tools.session_title" },
  session_push: { icon: Upload, label: "tools.session_push" },
  session_pr: { icon: GitPullRequest, label: "tools.session_pr" },
  session_navigate: { icon: Compass, label: "tools.session_navigate" },
};

export function toolIcon(name: string): LucideIcon {
  return TOOLS[name]?.icon ?? (name.startsWith("mcp__") ? Box : Wrench);
}

export function useToolLabel() {
  const { t } = useTranslations();
  return (name: string) => (TOOLS[name]?.label ? t(TOOLS[name].label!) : name.replace(/^mcp__\w+?__/, ""));
}

export { Bot };
