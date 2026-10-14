// A session's shells over the plane's terminal sockets (through the hub): bytes out, PTY bytes in; the first binary
// frame after a connect is the scrollback, a text frame {"type":"exit","code"} ends the shell, and a close at 4000
// and up says why the shell cannot run. The design system's Terminal draws what this carries.
import { useMemo } from "react";
import type { TerminalEvent, TerminalShell, TerminalSize, TerminalState, TerminalTransport } from "@hz/ui";
import { request, transport } from "./client";

// Tries to reopen a dropped socket before the shell reads as failed.
const TRIES = 4;

type Socket = { ws?: WebSocket; tries: number; timer?: ReturnType<typeof setTimeout>; size: TerminalSize; done: boolean };

const fresh = () => `sh-${Math.random().toString(36).slice(2, 8)}`;

class PlaneShells implements TerminalTransport {
  readonly key: string;
  private list: TerminalShell[] = [];
  private machine: TerminalState = { kind: "connecting" };
  private states = new Map<string, TerminalState>();
  private sockets = new Map<string, Socket>();
  private listeners = new Set<(e: TerminalEvent) => void>();

  constructor(private session: string) {
    this.key = `shells:${session}`;
  }

  private emit(e: TerminalEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private set(shell: string | undefined, state: TerminalState) {
    if (shell) this.states.set(shell, state);
    else this.machine = state;
    this.emit({ type: "state", shell, state });
  }

  shells() {
    return this.list;
  }

  state(shell?: string) {
    return shell ? (this.states.get(shell) ?? { kind: "connecting" }) : this.machine;
  }

  start() {
    request<{ id: string; command: string }[]>("GET", `sessions/${this.session}/terminals`).then(
      (shells) => {
        const known = new Set(shells.map((s) => s.id));
        this.list = [...shells.map((s) => ({ id: s.id, command: s.command })), ...this.list.filter((s) => !known.has(s.id))];
        this.emit({ type: "shells", shells: this.list });
        this.set(undefined, { kind: "live" });
      },
      (e) => this.set(undefined, { kind: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  }

  connect(shell: string, size: TerminalSize) {
    const s = this.sockets.get(shell) ?? { tries: 0, size, done: false };
    s.size = size;
    s.done = false;
    this.sockets.set(shell, s);
    if (s.ws && s.ws.readyState <= WebSocket.OPEN) return;
    this.open(shell, s);
  }

  private open(shell: string, s: Socket) {
    clearTimeout(s.timer);
    this.set(shell, { kind: "connecting" });
    transport.socketURL(`/sessions/${this.session}/terminals/${shell}?cols=${s.size.cols}&rows=${s.size.rows}`).then(
      (url) => {
        if (s.done) return;
        const ws = new WebSocket(url);
        s.ws = ws;
        ws.binaryType = "arraybuffer";
        let first = true;
        ws.onopen = () => {
          s.tries = 0;
          this.set(shell, { kind: "live" });
        };
        ws.onmessage = (e) => {
          if (typeof e.data === "string") {
            try {
              const msg = JSON.parse(e.data) as { type: string; code?: number };
              if (msg.type === "exit") {
                s.done = true;
                this.set(shell, { kind: "closed", reason: "The shell exited.", code: msg.code ?? 0 });
              }
            } catch {
              this.emit({ type: "data", shell, bytes: new TextEncoder().encode(e.data) });
            }
            return;
          }
          this.emit({ type: "data", shell, bytes: new Uint8Array(e.data as ArrayBuffer), replay: first });
          first = false;
        };
        ws.onclose = (e) => {
          if (s.done || s.ws !== ws) return;
          if (e.code >= 4000) {
            s.done = true;
            return this.set(shell, { kind: "closed", reason: e.reason || "The shell ended." });
          }
          this.retryLater(shell, s, e.reason || `The terminal socket closed (${e.code}).`);
        };
      },
      (e) => this.retryLater(shell, s, e instanceof Error ? e.message : String(e)),
    );
  }

  private retryLater(shell: string, s: Socket, why: string) {
    if (s.tries >= TRIES) return this.set(shell, { kind: "error", message: why });
    const wait = 500 * 2 ** s.tries++;
    this.set(shell, { kind: "connecting", retry: Math.ceil(wait / 1000) });
    s.timer = setTimeout(() => this.open(shell, s), wait);
  }

  send(shell: string, bytes: Uint8Array) {
    const ws = this.sockets.get(shell)?.ws;
    if (ws?.readyState === WebSocket.OPEN) ws.send(bytes);
  }

  resize(shell: string, size: TerminalSize) {
    const s = this.sockets.get(shell);
    if (!s) return;
    s.size = size;
    if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
  }

  close(shell: string) {
    const s = this.sockets.get(shell);
    if (!s) return;
    s.done = true;
    clearTimeout(s.timer);
    s.ws?.close();
    this.sockets.delete(shell);
  }

  async kill(shell: string) {
    this.close(shell);
    await request("DELETE", `sessions/${this.session}/terminals/${shell}`);
    this.list = this.list.filter((s) => s.id !== shell);
    this.emit({ type: "shells", shells: this.list });
  }

  create() {
    const id = fresh();
    this.list = [...this.list, { id, command: "shell" }];
    this.emit({ type: "shells", shells: this.list });
    return id;
  }

  retry(shell?: string) {
    if (!shell) return this.start();
    const s = this.sockets.get(shell);
    if (!s) return;
    s.tries = 0;
    s.done = false;
    this.open(shell, s);
  }

  subscribe(listener: (e: TerminalEvent) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

// One transport per session for the page's whole life: the Terminal keeps its screens by the transport's key.
const kept = new Map<string, PlaneShells>();
export function useShellTransport(session: string): TerminalTransport {
  return useMemo(() => kept.get(session) ?? kept.set(session, new PlaneShells(session)).get(session)!, [session]);
}
