import type { APIRequestContext, Page } from "@playwright/test";

export const hub = `http://127.0.0.1:${process.env.HUB_PORT ?? 5481}`;

export async function scenario(request: APIRequestContext, name: "fresh" | "ready") {
  await request.post(`${hub}/__scenario`, { data: { name } });
}

export async function writes(request: APIRequestContext): Promise<{ method: string; path: string; body: unknown }[]> {
  return (await request.get(`${hub}/__log`)).json();
}

// Signed in already: the device token in the e2e Keychain, the workspace remembered.
export async function signedIn(page: Page) {
  await page.addInitScript((host) => {
    localStorage.setItem(`e2e.keychain ${host}`, "e2e-device-token");
    localStorage.setItem("hz.workspace", "northwind");
  }, new URL(hub).host);
}
