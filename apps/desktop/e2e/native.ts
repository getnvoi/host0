// src/native.ts for the e2e build, export for export: the Keychain in localStorage, the browser's fetch, and links
// opened or followed through window hooks the tests drive.
type Hooks = { hzOpened?: string[]; hzDeepLink?: (url: string) => void };
const page = window as unknown as Hooks;

const key = (account: string) => `e2e.keychain ${account}`;

export const keychain = {
  get: async (account: string) => localStorage.getItem(key(account)),
  set: async (account: string, secret: string) => localStorage.setItem(key(account), secret),
  delete: async (account: string) => localStorage.removeItem(key(account)),
};

export const openURL = async (url: string) => {
  (page.hzOpened ??= []).push(url);
};

export async function onDeepLink(fn: (url: string) => void): Promise<() => void> {
  page.hzDeepLink = fn;
  return () => void (page.hzDeepLink = undefined);
}

export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);

export const drag = (_zoom: boolean) => {};

export const focus = () => {};
