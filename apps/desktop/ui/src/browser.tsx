import type { ReactNode } from "react";
import Markdown from "react-markdown";
import { cn } from "./cn";
import { Glyph } from "./glyph";
import { TextInput } from "./inputs";
import { alpha, Button, Dot, edge, IconButton, Item, itemSize, LeadView, Rule, Spinner } from "./primitives";
import { measure, palette, toneEdge, tone, type Tone } from "./tokens";

export type AgentStepState = "running" | "waiting" | "done" | "denied" | "failed";

export type BrowserBarProps = {
  address: string;
  onAddressChange?: (address: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  loading?: boolean;
  panel?: boolean;
  // The state of the agent's current step, if any.
  step?: AgentStepState;
  back?: () => void;
  forward?: () => void;
  reload?: () => void;
  go?: (address: string) => void;
  togglePanel?: () => void;
};

// The head of a tab on a web address: back, forward and reload on the left, the address in the middle (lock when
// secure), the agent's toggle on the right when there is a panel to open. Same height and edges as every page head. While the panel is closed,
// the toggle carries a dot when a step runs (blue) or waits on the person (yellow).
export function BrowserBar({
  address, onAddressChange, canGoBack, canGoForward, loading, panel, step, back, forward, reload, go, togglePanel,
}: BrowserBarProps) {
  const secure = address.startsWith("https://");
  const signal: Tone | undefined = panel ? undefined : step === "running" ? "blue" : step === "waiting" ? "yellow" : undefined;
  return (
    <div className="relative flex h-14 shrink-0 items-center px-4">
      <div className="flex flex-1 items-center gap-1">
        <IconButton glyph="back" label="Back" onClick={back} disabled={!canGoBack} />
        <IconButton glyph="forward" label="Forward" onClick={forward} disabled={!canGoForward} />
        {loading ? (
          <span className="flex size-7 items-center justify-center">
            <Spinner size={13} />
          </span>
        ) : (
          <IconButton glyph="reload" label="Reload" onClick={reload} />
        )}
        <span className="flex-1" />
        {togglePanel && (
          <Button kind={panel ? "selected" : "secondary"} size="small" glyph="sparkle" label="Agent" onClick={togglePanel}>
            <span className="inline-flex items-center gap-2">
              Agent
              {signal && <Dot tone={signal} />}
            </span>
          </Button>
        )}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-4 left-4 flex items-center justify-center px-[140px]">
        <div className="pointer-events-auto w-full" style={{ maxWidth: measure.page }}>
          <TextInput
            placeholder="Search or enter an address"
            value={address}
            onChange={onAddressChange}
            glyph={secure ? "lock" : "globe"}
            size="small"
            onSubmit={() => go?.(address)}
          />
        </div>
      </div>
      <Rule className="absolute right-0 bottom-0 left-0" />
    </div>
  );
}

export type SidePanelProps = {
  title: string;
  glyph: string;
  // The line under the title, after a `dot` when given.
  subtitle?: string;
  dot?: Tone;
  // One action before close.
  action?: { label: string; glyph: string; perform: () => void };
  // A notice (signed out, a network error) above the content; it does not scroll.
  notice?: ReactNode;
  close?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

// A panel docked on the right of a tab: its title and close, the content scrolling, a footer. The agent's
// conversation lives in one.
export function SidePanel({ title, glyph, subtitle, dot, action, notice, close, children, footer, className }: SidePanelProps) {
  const s = itemSize.small;
  return (
    <div className={cn("relative flex h-full w-[360px] shrink-0 flex-col bg-page", className)}>
      <div className="relative flex h-14 shrink-0 items-center gap-2.5 px-4">
        {subtitle ? (
          <div className="flex min-w-0 flex-1 items-center" style={{ gap: s.gap }}>
            <LeadView lead={{ visual: glyph }} size={s.lead} />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="max-w-full truncate font-medium text-ink" style={{ fontSize: s.title }}>
                {title}
              </span>
              <span className="flex max-w-full items-center gap-1.5">
                {dot && <Dot tone={dot} />}
                <span className="truncate text-tertiary" style={{ fontSize: s.sub }}>
                  {subtitle}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <Item title={title} lead={{ visual: glyph }} size="small" />
        )}
        {action && (
          <Button size="small" glyph={action.glyph} onClick={action.perform}>
            {action.label}
          </Button>
        )}
        <IconButton glyph="close" label="Close" onClick={close} />
        <Rule className="absolute right-0 bottom-0 left-0" />
      </div>
      {notice && <div className="shrink-0 px-4 pt-4">{notice}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-stretch p-4">{children}</div>
      </div>
      {footer && (
        <>
          <Rule />
          <div className="shrink-0 p-3">{footer}</div>
        </>
      )}
      <Rule vertical className="absolute top-0 bottom-0 left-0" />
    </div>
  );
}

// The panel's text column, from the content edge: where the header's text starts past its lead.
const column = itemSize.small.lead + itemSize.small.gap;

// One step the agent takes: its mark (working, waiting on you, done, denied, failed), what it does, and Allow
// or Deny while it waits. A denied or failed step says why on a second line ("The tab is offline", "No answer in
// time", "Nobody decided").
export function AgentStep({ text, state, reason, allow, deny }: { text: string; state: AgentStepState; reason?: string; allow?: () => void; deny?: () => void }) {
  const why = state === "denied" || state === "failed" ? reason : undefined;
  const waiting = state === "waiting";
  return (
    <div
      data-testid={`step:${text}`}
      className="flex flex-col items-stretch gap-2 rounded-block px-3 py-2.5"
      style={{ background: waiting ? tone.yellow.fill : palette.quiet, ...edge(waiting ? alpha(tone.yellow.ink, toneEdge) : alpha(palette.ink, 0.03)) }}
    >
      <div className="flex items-start gap-2.5">
        {/* Card padding, mark and gap end on the column. */}
        <span className="mt-[1.5px] flex h-4 shrink-0 items-center justify-center" style={{ width: column - 12 - 10 }}>
          <StepMark state={state} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("line-clamp-3 text-[13px] leading-4", state === "denied" ? "text-tertiary" : "text-ink")}>{text}</span>
          {why && <span className={cn("line-clamp-2 text-[12px]", state === "failed" ? "text-red-ink" : "text-tertiary")}>{why}</span>}
        </div>
      </div>
      {waiting && (
        <div className="flex items-center justify-end gap-2">
          <Button kind="primary" size="small" onClick={allow}>
            Allow
          </Button>
          <Button size="small" onClick={deny}>
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}

function StepMark({ state }: { state: AgentStepState }) {
  switch (state) {
    case "running":
      return <Spinner size={11} color={tone.blue.dot} />;
    case "waiting":
      return <Dot tone="yellow" />;
    case "done":
      return <Glyph name="check" size={11} color={tone.green.ink} width={2} />;
    case "denied":
      return <Glyph name="close" size={10} color={palette.tertiary} width={2} />;
    case "failed":
      return <Glyph name="close" size={10} color={tone.red.ink} width={2} />;
  }
}

// A short exchange in a side panel: the person's words in a grey bubble, the agent's reply as prose, both on the
// steps' text column.
export function PanelMessage({ text, mine }: { text: string; mine: boolean }) {
  if (mine) {
    // The fill reaches out to the content edge; the words start on the column.
    return (
      <div className="rounded-block bg-area py-[9px] pr-3 text-[13px] text-ink" style={{ paddingLeft: column }}>
        {text}
      </div>
    );
  }
  return (
    <div className="text-[13px] leading-[19px] whitespace-pre-wrap text-ink select-text" style={{ paddingLeft: column }}>
      <Markdown
        allowedElements={["p", "strong", "em", "code", "a", "del"]}
        unwrapDisallowed
        components={{
          p: ({ children }) => <>{children}</>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          code: ({ children }) => <code className="font-mono text-[12.5px]">{children}</code>,
          a: ({ children, href }) => (
            <a href={href} className="underline">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

// The agent's box: the task, and send or stop. Whether a call asks first is the tool's own level, decided in the
// session. Disabled (signed out, offline), the field and send are off and `reason` shows beside them.
export function PanelComposer({ draft, onDraftChange, busy, disabled, reason, send, stop }: {
  draft: string; onDraftChange?: (draft: string) => void; busy: boolean; disabled?: boolean; reason?: string; send?: () => void; stop?: () => void;
}) {
  const typed = draft.trim().length > 0;
  const on = typed && !disabled;
  return (
    <div className="flex flex-col items-stretch gap-2">
      <TextInput
        placeholder="What should I do in this tab?"
        value={draft}
        onChange={onDraftChange}
        rows={2}
        disabled={disabled}
        onSubmit={() => typed && !busy && !disabled && send?.()}
      />
      <div className="flex items-center gap-2">
        {disabled && reason && <span className="truncate text-[12px] text-tertiary">{reason}</span>}
        <span className="flex-1" />
        {busy && !disabled ? (
          <IconButton glyph="stop" label="Stop" fill={palette.ink} color={palette.onSolid} size={30} onClick={stop} />
        ) : (
          <IconButton glyph="arrowUp" label="Send" fill={on ? palette.ink : palette.area} color={on ? palette.onSolid : palette.tertiary} size={30} disabled={!on} onClick={send} />
        )}
      </div>
    </div>
  );
}
