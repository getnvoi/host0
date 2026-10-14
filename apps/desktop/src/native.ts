import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// What only the Tauri shell does. The e2e build replaces this module with e2e/native.ts, export for export.
export const keychain = {
  get: (account: string) => invoke<string | null>("keychain_get", { account }),
  set: (account: string, secret: string) => invoke<void>("keychain_set", { account, secret }),
  delete: (account: string) => invoke<void>("keychain_delete", { account }),
};

export const openURL = (url: string) => invoke<void>("open_url", { url });

export async function onDeepLink(fn: (url: string) => void): Promise<() => void> {
  return onOpenUrl((urls) => urls.forEach(fn));
}

// Requests from Rust, which no CORS rule applies to: the hub is another origin than the app's.
export const fetch: typeof globalThis.fetch = tauriFetch;

// The window has no title bar: empty parts of the top drag it, a double click zooms it.
export const drag = (zoom: boolean) => void (zoom ? getCurrentWindow().toggleMaximize() : getCurrentWindow().startDragging());

export const focus = () => void getCurrentWindow().setFocus();
