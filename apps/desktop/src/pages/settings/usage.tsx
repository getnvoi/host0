// Usage from the hub, which bills the workspace: `GET /v1/workspaces/{ws}/usage?days=`, read again when the range
// changes. The report comes in the screen's own shape, its dates as ISO strings.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { remote, UsageScreen, type Remote, type UsageReport } from "@h0/ui";
import { workspace } from "../../api/client";
import { useHub } from "../../api/live";
import { message } from "../../api/session";

type Wire = Omit<UsageReport, "from" | "to" | "trialUntil" | "byDay"> & {
  from: string;
  to: string;
  trialUntil?: string;
  byDay: (Omit<UsageReport["byDay"][number], "date"> & { date: string })[];
};

const reportOf = (w: Wire): UsageReport => ({
  ...w,
  from: new Date(w.from),
  to: new Date(w.to),
  trialUntil: w.trialUntil ? new Date(w.trialUntil) : undefined,
  byDay: w.byDay.map((d) => ({ ...d, date: new Date(d.date) })),
});

export function UsagePage() {
  const [params] = useSearchParams();
  const [days, setDays] = useState(Number(params.get("days")) || 30);
  const usage = useHub<Wire>(`workspaces/${encodeURIComponent(workspace() ?? "")}/usage?days=${days}`);
  const report: Remote<UsageReport> = usage.data ? remote.loaded(reportOf(usage.data)) : usage.error ? remote.failed(message(usage.error)) : "loading";
  return <UsageScreen report={report} range={setDays} retry={() => void usage.refetch()} />;
}
