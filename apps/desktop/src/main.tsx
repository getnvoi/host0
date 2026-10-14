import { Component, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorState } from "@hz/ui";
import * as native from "@/native";
import { Shell } from "./shell";
import { themeStore } from "./theme";
import { LiveProvider } from "./api/live";
import { listenForLinks } from "./api/link";
import "./app.css";

themeStore.start();

// The window has no title bar: empty parts of the strip drag it, a double click zooms it.
const DRAG = "[data-drag]";
const ACTS = "a, button, input, textarea, select, label, [role=button], [contenteditable]";
function drag(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (e.button !== 0 || !target.closest(DRAG) || target.closest(ACTS)) return;
  native.drag(e.detail === 2);
}

// A hot reload runs this module again: one listener and one root for the page's whole life.
const page = window as unknown as { hzRoot?: Root; hzDrag?: (e: MouseEvent) => void };
if (page.hzDrag) document.removeEventListener("mousedown", page.hzDrag);
page.hzDrag = drag;
document.addEventListener("mousedown", drag);

// A failed render shows what failed instead of a blank window.
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div data-drag className="flex h-full items-center justify-center bg-page p-10">
        <ErrorState title="The app failed to draw" message={this.state.error.message} retry={() => location.reload()} />
      </div>
    );
  }
}

page.hzRoot ??= createRoot(document.getElementById("app")!);
void listenForLinks();
page.hzRoot.render(
  <StrictMode>
    <Boundary>
      <LiveProvider>
        <Shell />
      </LiveProvider>
    </Boundary>
  </StrictMode>,
);
