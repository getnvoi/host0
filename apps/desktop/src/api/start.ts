// Signing in with GitHub through the hub: PKCE, with the verifier kept here and the challenge sent; the browser comes
// back as <scheme>://auth with a code only this verifier trades for a device token.
import { ApiError, hub, hubRequest, openUrl, scheme } from "./client";
import { returnFor, returnOr } from "./link";

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

// The hub's state lasts ten minutes; past it, nothing can come back.
const waitFor = 10 * 60_000;

// Opens the hub's sign-in in the browser and resolves to the device token; rejects with the hub's reason.
export async function signInWithGithub(stopped: () => boolean = () => false): Promise<string> {
  const verifier = random(32);
  const state = random(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await openUrl(`${hub}/v1/auth/github?${new URLSearchParams({ challenge, method: "S256", state, redirect: `${scheme}://auth` })}`);
  const until = Date.now() + waitFor;
  while (Date.now() < until && !stopped()) {
    await returnOr(2_000);
    const back = returnFor(state);
    if (!back) continue;
    if (back.error || !back.code) throw new Error(back.error ?? "GitHub sent no code back. Sign in again.");
    try {
      return (await hubRequest<{ token: string }>("POST", "auth/token", { code: back.code, verifier })).token;
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) throw new Error(`${e.message} Sign in again.`);
      throw e;
    }
  }
  throw new Error(stopped() ? "Stopped." : "Nothing came back from GitHub. Sign in with GitHub again.");
}
