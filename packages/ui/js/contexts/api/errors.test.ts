import { AxiosError, AxiosHeaders } from "axios";
import { messageFrom } from "@/contexts/api/errors";
import type { TFunction } from "@/contexts/i18n";

const t = ((key: string, o?: { status?: number }) => (o?.status ? `${key}:${o.status}` : key)) as unknown as TFunction;

function failed(status: number, data: unknown, type = "text/plain") {
  const headers = new AxiosHeaders({ "content-type": type });
  return new AxiosError("x", "ERR", undefined, undefined, { status, data, headers, statusText: "", config: { headers } });
}

test("the plane's sentence is shown; a page of HTML is not", () => {
  expect(messageFrom(failed(409, "approval a is done\n"), t)).toBe("approval a is done");
  expect(messageFrom(failed(502, "<html><body>Bad gateway</body></html>", "text/html"), t)).toBe("errors.status:502");
  expect(messageFrom(failed(502, "<!doctype html><p>down"), t)).toBe("errors.status:502");
  expect(messageFrom(failed(500, ""), t)).toBe("errors.status:500");
});
