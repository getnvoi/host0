import { isAxiosError } from "axios";
import type { TFunction } from "@/contexts/i18n";

// The plane answers a failure with problem+json whose detail is the failing thing's sentence, or with a sentence as
// text/plain. That sentence is shown; without one, or when a proxy answered with a page of HTML, the status is.
export function messageFrom(error: unknown, t: TFunction): string {
  if (!isAxiosError(error)) return t("errors.unexpected");
  if (!error.response) return t("errors.unreachable");
  const body = error.response.data;
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string" && detail.trim()) return clip(detail.trim());
  const type = String(error.response.headers?.["content-type"] ?? "");
  if (typeof body === "string" && body.trim() && !type.includes("html") && !/^\s*</.test(body)) {
    return clip(body.trim());
  }
  return t("errors.status", { status: error.response.status });
}

const clip = (text: string) => (text.length > 300 ? text.slice(0, 300) + "…" : text);
