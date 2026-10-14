import { useState, type ReactNode } from "react";
import { hasFailed, useDelayedBusy } from "../../busy";
import { TerminalBlock } from "../../conversation";
import { ConfirmDialog, Drawer } from "../../heads";
import { menu, type MenuEntry } from "../../menu";
import { Button, LoadingState } from "../../primitives";
import { EmptyState, ErrorState } from "../../start";
import type { Load, MachineRecord, OutputRecord, ProcessRecord, StopRecord } from "./records";

export type Signal = "TERM" | "KILL";

// A stop asked of a process from the machine's menu, waiting on its confirm.
export type ProcessStop = { process: ProcessRecord; signal: Signal };

// What nvoi's own processes are, by their `role`.
export const processRoles: Record<string, string> = {
  turn: "Agent turn",
  preview: "Preview server",
  artifact: "Artifact app",
  terminal: "Terminal server",
  proxy: "Preview proxy",
  sshd: "SSH server",
  init: "Init",
};

// Processes the menu lists at most, by memory.
const shown = 12;

export const machineWords = {
  bytes(n: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    return `${v >= 10 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
  },
  uptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d} ${d === 1 ? "day" : "days"} ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${Math.max(m, 1)} min`;
  },
  // The process as a person names it: its role, else its program.
  name: (p: ProcessRecord) => (p.role ? (processRoles[p.role] ?? p.name) : p.name),
  cpu: (p: ProcessRecord) => `${p.cpu.toFixed(p.cpu >= 10 ? 0 : 1)}% CPU`,
  // Its pid, memory and CPU, and whose it is when it cannot be stopped.
  detail: (p: ProcessRecord, still = false) =>
    [still ? "Still running" : undefined, String(p.pid), machineWords.bytes(p.rss), machineWords.cpu(p), !p.killable ? (p.role ? "nvoi" : p.user) : undefined]
      .filter(Boolean)
      .join(" · "),
};

export type MachineEntriesOptions = {
  // Asks to stop a process: the confirm opens.
  ask?: (stop: ProcessStop) => void;
  // Opens a process's details, its log, in the drawer.
  details?: (process: ProcessRecord) => void;
  // Starts a machine that is down (`POST /worktrees/{id}/preview`); reads it again after a failure.
  start?: () => void;
  retry?: () => void;
  // The last stop's answer: a process still running after TERM is offered Force stop.
  stop?: Load<StopRecord>;
};

// The machine's processes as menu rows, for the session head's machine menu: a header with memory, load and uptime,
// then the processes by memory with their pid, memory and CPU. A row opens its details; its buttons stop it (asked
// first; nvoi's own and other users' cannot be stopped) and open its details. Undefined is not read yet.
export function machineEntries(machine: Load<MachineRecord> | undefined, options: MachineEntriesOptions = {}): MenuEntry[] {
  const { ask, details, start, retry, stop } = options;
  if (!machine || machine === "loading") return [menu.header("Machine", "Reading its processes", { visual: "server" })];
  if ("failed" in machine) {
    if (machine.code === "not_running") return [menu.header("Machine", "Not running", { visual: "server" }), menu.item("Start machine", { glyph: "play", action: start })];
    return [menu.header("Machine", "It did not answer", { visual: "server" }), menu.item("Try again", { glyph: "retry", detail: machine.failed, action: retry })];
  }
  const m = machine.value;
  const said = [
    `${machineWords.bytes(m.memory.used)} of ${machineWords.bytes(m.memory.total)}`,
    `load ${(m.cpu.load[0] ?? 0).toFixed(2)} on ${m.cpu.cores}`,
    `up ${machineWords.uptime(m.uptime)}`,
  ].join(" · ");
  const running = stop && stop !== "loading" && "value" in stop && stop.value.result === "running" ? stop.value.pid : undefined;
  const rows = m.processes.slice(0, shown).map((p) => {
    const force = p.pid === running;
    return menu.item(machineWords.name(p), {
      detail: machineWords.detail(p, force),
      action: () => details?.(p),
      actions: [
        { glyph: "stop", label: `${force ? "Force stop" : "Stop"} ${p.pid}`, disabled: !p.killable, action: () => ask?.({ process: p, signal: force ? "KILL" : "TERM" }) },
        { glyph: "doc", label: `Details of ${p.pid}`, action: () => details?.(p) },
      ],
    });
  });
  return [menu.header("Machine", said, { visual: "server" }), menu.title("Processes"), ...rows];
}

const streamWords: Record<LogStream, string> = { connecting: "Connecting", live: "Live", ended: "Ended", lost: "Disconnected" };

// Asks before a process is stopped: which one, and what stopping it does. The agent's turn stops as Stop agent stops
// it; anything else stops answering, and the agent is told at its next turn.
export function ProcessStopDialog({ stop, confirm, cancel }: { stop: ProcessStop; confirm?: () => void; cancel?: () => void }) {
  const p = stop.process;
  const force = stop.signal === "KILL";
  const how = force ? "It ends at once, without finishing what it is doing." : "It is asked to end and may finish what it is doing first.";
  const what =
    p.role === "turn"
      ? "This is the agent's running turn: the turn stops, as Stop agent stops it. What it changed so far stays."
      : "Whatever it serves stops answering until it is started again. The agent is told at its next turn.";
  const command = p.command.length > 80 ? `${p.command.slice(0, 79)}…` : p.command;
  return (
    <ConfirmDialog
      title={`${force ? "Force stop" : "Stop"} ${machineWords.name(p)} (${p.pid})?`}
      message={`It runs ${command}. ${how} ${what}`}
      action={force ? "Force stop process" : "Stop process"}
      glyph="stop"
      confirm={confirm}
      cancel={cancel}
    />
  );
}

// A log's stream: connecting, live, ended (the command following it stopped) or lost (the socket dropped).
export type LogStream = "connecting" | "live" | "ended" | "lost";

// One process's details: who runs it, its memory and CPU, and its log, streamed live: lines append as they are
// written, the view following the end unless the person scrolled up. Refresh reads it again. `received` counts the
// lines streamed so far.
export function ProcessDrawer({
  process: p, output, stream, received = 0, refresh, close,
}: { process: ProcessRecord; output: Load<OutputRecord>; stream?: LogStream; received?: number; refresh?: () => void; close: () => void }) {
  const [wide, setWide] = useState(false);
  const held = useDelayedBusy(output === "loading", hasFailed(output));
  let content: ReactNode;
  if (output === "loading" || held) content = <LoadingState text="Reading its log" />;
  else if ("failed" in output) content = <ErrorState title="The log did not load" message={output.failed} retry={refresh} />;
  else if (!output.value.source) content = <EmptyState glyph="doc" title="No logs for this process" text="nvoi did not start it, so its output is not kept." />;
  else if (output.value.lines.length === 0) content = <EmptyState glyph="doc" title="Nothing logged yet" text="Its output shows here once it writes some." />;
  else content = <TerminalBlock lines={output.value.lines.map((text) => ({ text }))} />;
  return (
    <Drawer
      title={machineWords.name(p)}
      line={{ sub: [p.user, machineWords.detail({ ...p, killable: true }), stream && streamWords[stream]].filter(Boolean).join(" · ") }}
      lead={{ visual: "server" }}
      trailing={
        <Button size="small" glyph="reload" loading={output === "loading"} onClick={refresh}>
          Refresh
        </Button>
      }
      pin={output !== "loading" && "value" in output ? `${output.value.lines.length}:${received}` : undefined}
      expanded={wide}
      onExpand={setWide}
      close={close}
    >
      {content}
    </Drawer>
  );
}
