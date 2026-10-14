import { cn } from "./cn";
import { useDelayedBusy } from "./busy";
import { alpha, edge, LoadingState } from "./primitives";
import { palette } from "./tokens";
import { EmptyState } from "./start";

export type WebFrameState = { running: string } | "starting" | { stopped: string };

// A running page shown in place: an artifact, an app, a preview. Without a URL it says why it is not running.
// `glyph` heads the stopped state: what the frame shows (an app, a preview). `flush` fills its area edge to edge,
// square, as in the split's pane.
export function WebFrame({ state, glyph = "app", title = "Page", flush, className }: { state: WebFrameState; glyph?: string; title?: string; flush?: boolean; className?: string }) {
  const held = useDelayedBusy(state === "starting", typeof state === "object" && "stopped" in state);
  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-web", !flush && "rounded-block", className)}>
      {state === "starting" || held ? (
        <LoadingState text="Starting" />
      ) : "running" in state ? (
        <iframe src={state.running} title={title} className="absolute inset-0 size-full border-0 bg-web" />
      ) : (
        <EmptyState glyph={glyph} title="Not running" text={state.stopped} />
      )}
      {!flush && <span className="pointer-events-none absolute inset-0 rounded-block" style={edge(alpha(palette.ink, 0.07))} />}
    </div>
  );
}
