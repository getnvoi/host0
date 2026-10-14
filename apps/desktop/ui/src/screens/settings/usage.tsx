import { useState } from "react";
import { hasFailed, useDelayedBusy } from "../../busy";
import { CardRow, CellText, ColumnHeads, Legend, SectionHead, StackedBars, Stat, TableRow, type Bar, type Series } from "../../data";
import { PageHead } from "../../heads";
import { Button, Item, LoadingState, Segments } from "../../primitives";
import { EmptyState, ErrorState } from "../../start";
import { chart } from "../../tokens";
import { useNavigate } from "../navigate";
import { paths } from "../routes";
import { SettingsShell } from "../shell";
import { envKey, remote, repoShort, settingsFormat as format, spendTokens, type Remote, type UsageEnvironment, type UsageMachine, type UsageReport, type UsageSpend, type UsageStorage } from "./models";
import { settingsSamples } from "./samples";

export type UsageScreenProps = {
  report?: Remote<UsageReport>;
  // Asks for another range of days (`Usage::RANGES`).
  range?: (days: number) => void;
  retry?: () => void;
};

const fallback = [7, 14, 30, 90];

// Where the workspace's credit went over a range of days: the credit left, spend per day by environment, machine
// time, then spend by environment, repository and session; then what the agents' runs cost at the model's prices,
// by day, agent and session (`GET /usage`).
export function UsageScreen({ report = remote.loaded(settingsSamples.usage()), range = () => {}, retry }: UsageScreenProps) {
  const r = remote.value(report);
  const held = useDelayedBusy(report === "loading", hasFailed(report));
  const ranges = r?.ranges.length ? r.ranges : fallback;
  const [days, setDays] = useState(r?.days ?? 30);
  const selection = Math.max(ranges.indexOf(days), 0);
  const navigate = useNavigate();
  return (
    <SettingsShell
      active="Usage"
      head={
        <PageHead
          title="Usage"
          glyph="chart"
          center={
            <Segments
              items={ranges.map((d) => `${d} days`)}
              selection={selection}
              onChange={(i) => {
                setDays(ranges[i]);
                range(ranges[i]);
              }}
            />
          }
          action={
            <Button size="small" onClick={() => navigate(paths.settings("billing"))}>
              Plan and credit
            </Button>
          }
        />
      }
    >
      {report === "loading" || held ? (
        <LoadingState text="Loading usage" />
      ) : "failed" in report ? (
        <ErrorState title="Usage did not load" message={report.failed} retry={retry} />
      ) : (
        <UsagePage r={report.loaded} />
      )}
    </SettingsShell>
  );
}

// A day's label: every day over a week, every fifth day beyond, so labels keep to their bars.
function label(r: UsageReport, i: number) {
  const date = r.byDay[i].date;
  if (r.days <= 7) return format.short(date);
  return i % 5 === 0 ? format.day(date) : "";
}

// `UsageHelper#usage_environment`.
const name = (e?: UsageEnvironment) => (e ? `${repoShort(e.repo)} · ${e.name}` : "Removed machines");

// `UsageHelper#usage_spend_chart`: one series per environment, largest first; past the chart's colours the rest sum
// to one series. Dollars.
function spend(r: UsageReport): { series: Series[]; bars: Bar[] } {
  const lines = r.environments.map((l) => l.environment);
  const cut = lines.length > chart.length ? chart.length - 1 : lines.length;
  const shown = lines.slice(0, cut);
  const rest = lines.slice(cut);
  const series: Series[] = shown.map((e, i) => ({ name: name(e), color: chart[i] }));
  if (rest.length) series.push({ name: `${rest.length} more environments`, color: chart[cut] });
  const bars = r.byDay.map((day, i) => {
    const values = shown.map((e) => (day.cents[envKey(e)] ?? 0) / 100);
    if (rest.length) values.push(rest.reduce((sum, e) => sum + (day.cents[envKey(e)] ?? 0), 0) / 100);
    return { label: label(r, i), values };
  });
  return { series, bars };
}

// A spend's cents, or its tokens when no runner stated a price.
const priced = (s: UsageSpend, currency: string) => (s.cents === undefined ? `${format.tokens(spendTokens(s))} tokens` : format.money(s.cents, currency));

const peak = (bars: Bar[]) => Math.max(0, ...bars.map((b) => b.values.reduce((a, v) => a + v, 0)));

// `UsageHelper#usage_machine`: a setup machine reads as its environment's setup, a checkout as its session's title,
// or its branch when no session was started on it.
const title = (m: UsageMachine) => (m.setup ? `${m.environment.name} setup` : (m.session?.title ?? m.branch ?? ""));
const line = (m: UsageMachine) => `${m.setup ? "Setup" : "Checkout"} · ${repoShort(m.environment.repo)} · ${m.environment.name}`;

// A storage category as the page names it, and its glyph.
const stored: Record<string, { title: string; visual: string }> = {
  images: { title: "Images", visual: "server" },
  library: { title: "Library", visual: "file" },
  artifacts: { title: "Artifacts", visual: "artifact" },
  repositories: { title: "Hosted repositories", visual: "repo" },
};

// Images are kept per production environment: the line names it.
const storedLine = (l: UsageStorage) => (l.environment ? `${repoShort(l.environment.repo)} · ${l.environment.name}` : undefined);

// The report once loaded: the charts and the machines.
function UsagePage({ r }: { r: UsageReport }) {
  const navigate = useNavigate();
  const any = r.environments.length > 0;
  const money = spend(r);
  const moneyScale = format.scale(peak(money.bars), 0.01);
  const time: Series[] = [{ name: "Running", color: chart[0] }, { name: "Paused", color: chart[2] }];
  const timeBars = r.byDay.map((d, i) => ({ label: label(r, i), values: [d.running, d.paused] }));
  const timeScale = format.scale(peak(timeBars));
  // What the agents' runs cost at the model's API prices, paid to the provider under the workspace's credential.
  // A runner that states no price counts in tokens only.
  const models: Series[] = [{ name: "Models", color: chart[0] }];
  const modelBars = r.byDay.map((d, i) => ({ label: label(r, i), values: [(d.spend ?? 0) / 100] }));
  const modelScale = format.scale(peak(modelBars), 0.01);
  const ran = r.agents.length > 0;
  return (
    <div className="flex flex-col items-stretch gap-10">
      <CardRow>
        <Stat
          label="Machines"
          value={format.money(r.cents, r.currency)}
          detail={[
            r.machinesAtOnce === undefined ? `${r.running} running now` : `${r.running} running now, ${r.machinesAtOnce} at a time`,
            // A trial takes no credit: its machine costs are written to the trial, not to the wallet.
            r.trialUntil && r.trialCents !== undefined ? `${format.money(r.trialCents, r.currency)} covered by the trial` : "",
          ].filter(Boolean).join(", ")}
          tone={r.running > 0 ? "green" : "grey"}
        />
        <Stat label="Models" value={priced(r.spend, r.currency)} detail={`${format.tokens(spendTokens(r.spend))} tokens, not from credit`} />
        <Stat
          label="Credit left"
          value={format.money(r.creditLeft, r.currency)}
          detail={r.trialUntil ? `Trial until ${format.long(r.trialUntil)}` : "Prepaid, topped up under Billing"}
          tone={r.spendable ? undefined : "red"}
        />
        <Stat label="Sessions" value={`${r.sessions}`} detail={`Started in these ${r.days} days`} />
      </CardRow>
      <div className="flex flex-col items-stretch gap-4">
        <SectionHead title="Spend by day" text="What machines cost each day, by environment. An environment's setup machine counts with it." />
        {any ? (
          <>
            <Legend series={money.series} />
            <StackedBars series={money.series} bars={money.bars} top={moneyScale.top} ticks={moneyScale.ticks} label={(tick) => format.money(tick * 100, r.currency)} />
          </>
        ) : (
          <EmptyState text={`No machine ran in these ${r.days} days.`} />
        )}
      </div>
      {any && (
        <>
          <div className="flex flex-col items-stretch gap-4">
            <SectionHead title="Running and paused" text="Machine time each day. A paused machine keeps its disk and costs nothing." />
            <Legend series={time} />
            <StackedBars series={time} bars={timeBars} top={timeScale.top} ticks={timeScale.ticks} unit="h" />
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <SectionHead title="By environment" />
            <div className="flex flex-col">
              <ColumnHeads columns={[["Environment", null], ["Machine", 64], ["Sessions", 72, "trailing"], ["Setup", 72, "trailing"], ["Spent", 80, "trailing"]]} />
              {r.environments.map((l, i) => {
                const e = l.environment;
                return e ? (
                  <TableRow key={i} index={i} action={() => navigate(paths.environment(e.id), "here", e.name)} className="gap-4">
                    <Item title={e.name} line={{ sub: repoShort(e.repo) }} lead={{ visual: "terminal" }} />
                    <CellText text={format.size(e.shape)} width={64} />
                    <CellText text={`${l.sessions}`} width={72} alignment="trailing" kind="number" />
                    <CellText text={format.money(l.setup, r.currency)} width={72} alignment="trailing" kind="number" />
                    <CellText text={format.money(l.cents, r.currency)} width={80} alignment="trailing" kind="number" />
                  </TableRow>
                ) : (
                  <TableRow key={i} index={i} className="gap-4">
                    <Item title={name(undefined)} line={{ sub: "Their checkout or environment was deleted" }} lead={{ visual: "archive" }} />
                    <CellText width={64} />
                    <CellText width={72} />
                    <CellText width={72} />
                    <CellText text={format.money(l.cents, r.currency)} width={80} alignment="trailing" kind="number" />
                  </TableRow>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <SectionHead title="By repository" />
            <div className="flex flex-col">
              <ColumnHeads columns={[["Repository", null], ["Environments", 100, "trailing"], ["Spent", 80, "trailing"]]} />
              {r.repositories.map((share, i) => {
                const parts = share.repo.split("/");
                return (
                  <TableRow key={i} index={i} className="gap-4">
                    <Item title={parts[parts.length - 1]} line={{ over: parts.length > 1 ? parts[0] : "" }} lead={{ visual: "repo" }} />
                    <CellText text={`${share.environments}`} width={100} alignment="trailing" kind="number" />
                    <CellText text={format.money(share.cents, r.currency)} width={80} alignment="trailing" kind="number" />
                  </TableRow>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <SectionHead title="By session" text="The machines that cost the most: each session's checkout, and each environment's setup machine." />
            <div className="flex flex-col">
              <ColumnHeads columns={[["Machine", null], ["Running", 80, "trailing"], ["Spent", 80, "trailing"]]} />
              {r.machines.map((m, i) => (
                <TableRow
                  key={i}
                  index={i}
                  className="gap-4"
                  action={() =>
                    m.session && !m.session.hidden
                      ? navigate(paths.session(m.session.id), "here", m.session.title)
                      : navigate(paths.environment(m.environment.id), "here", m.environment.name)
                  }
                >
                  <Item title={title(m)} line={{ sub: line(m) }} lead={{ visual: m.setup ? "terminal" : "session" }} />
                  <CellText text={format.time(m.running)} width={80} alignment="trailing" kind="number" />
                  <CellText text={format.money(m.cents, r.currency)} width={80} alignment="trailing" kind="number" />
                </TableRow>
              ))}
            </div>
          </div>
        </>
      )}
      {r.storage.length > 0 && (
        <div className="flex flex-col items-stretch gap-3">
          <SectionHead title="Storage" text="What the stored files and repositories cost, measured once a day. The size is the last day's." />
          <div className="flex flex-col">
            <ColumnHeads columns={[["Category", null], ["Size", 80, "trailing"], ["Spent", 80, "trailing"]]} />
            {r.storage.map((l, i) => (
              <TableRow key={i} index={i} className="gap-4">
                <Item title={stored[l.category]?.title ?? l.category} line={{ sub: storedLine(l) ?? "" }} lead={{ visual: stored[l.category]?.visual ?? "archive" }} />
                <CellText text={format.bytes(l.bytes)} width={80} alignment="trailing" kind="number" />
                <CellText text={format.money(l.cents, r.currency)} width={80} alignment="trailing" kind="number" />
              </TableRow>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col items-stretch gap-4">
        <SectionHead title="Model spend by day" text="What the agents' runs cost at the model's API prices, paid to the model provider and not from credit. Codex states no price: its runs count in tokens only." />
        {ran ? (
          <StackedBars series={models} bars={modelBars} top={modelScale.top} ticks={modelScale.ticks} label={(tick) => format.money(tick * 100, r.currency)} />
        ) : (
          <EmptyState text={`No agent ran in these ${r.days} days.`} />
        )}
      </div>
      {ran && (
        <>
          <div className="flex flex-col items-stretch gap-3">
            <SectionHead title="Model spend by agent" />
            <div className="flex flex-col">
              <ColumnHeads columns={[["Agent", null], ["Sessions", 72, "trailing"], ["Runs", 64, "trailing"], ["Tokens", 80, "trailing"], ["Spent", 80, "trailing"]]} />
              {r.agents.map((a, i) => {
                const agent = a.agent;
                return (
                  <TableRow key={i} index={i} className="gap-4" action={agent ? () => navigate(paths.agent(agent.id), "here", agent.name) : undefined}>
                    <Item title={agent?.name ?? "No agent"} lead={{ visual: "bot" }} />
                    <CellText text={`${a.sessions}`} width={72} alignment="trailing" kind="number" />
                    <CellText text={`${a.spend.runs}`} width={64} alignment="trailing" kind="number" />
                    <CellText text={format.tokens(spendTokens(a.spend))} width={80} alignment="trailing" kind="number" />
                    <CellText text={a.spend.cents === undefined ? undefined : format.money(a.spend.cents, r.currency)} placeholder="No price" width={80} alignment="trailing" kind="number" />
                  </TableRow>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <SectionHead title="Model spend by session" text="The sessions whose runs cost the most, their workflow steps counted with them." />
            <div className="flex flex-col">
              <ColumnHeads columns={[["Session", null], ["Runs", 64, "trailing"], ["Tokens", 80, "trailing"], ["Spent", 80, "trailing"]]} />
              {r.costly.map((c, i) => (
                <TableRow
                  key={i}
                  index={i}
                  className="gap-4"
                  action={c.session.hidden ? undefined : () => navigate(paths.session(c.session.id), "here", c.session.title)}
                >
                  <Item title={c.session.title} line={c.agent ? { sub: c.agent } : undefined} lead={{ visual: "session" }} />
                  <CellText text={`${c.spend.runs}`} width={64} alignment="trailing" kind="number" />
                  <CellText text={format.tokens(spendTokens(c.spend))} width={80} alignment="trailing" kind="number" />
                  <CellText text={c.spend.cents === undefined ? undefined : format.money(c.spend.cents, r.currency)} placeholder="No price" width={80} alignment="trailing" kind="number" />
                </TableRow>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
