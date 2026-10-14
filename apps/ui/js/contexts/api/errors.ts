import { isAxiosError } from "axios";
import type { TFunction } from "@/contexts/i18n";

// The plane answers a failure with a sentence (text/plain). That sentence is shown; without one, or when a proxy on
// the way answered with a page of HTML, the status is.
export function messageFrom(error: unknown, t: TFunction): string {
  if (!isAxiosError(error)) return t("errors.unexpected");
  if (!error.response) return t("errors.unreachable");
  const body = error.response.data;
  const type = String(error.response.headers?.["content-type"] ?? "");
  if (typeof body === "string" && body.trim() && !type.includes("html") && !/^\s*</.test(body)) {
    const text = body.trim();
    return text.length > 300 ? text.slice(0, 300) + "…" : text;
  }
  return t("errors.status", { status: error.response.status });
}
