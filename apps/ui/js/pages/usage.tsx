import { useSearchParams } from "react-router-dom";
import { useTranslations, type TFunction } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useUsage } from "@/contexts/api/sessions";
import type { Usage, UsageDay } from "@/contexts/api/types";
import { Shell } from "@/shell/shell";
import { Alert } from "@/ds/alert";
import { Box } from "@/ds/box";
import { Button } from "@/ds/button";
import { Head } from "@/ds/head";
import { List, ListCell, ListName, ListRow } from "@/ds/list";
import { Menu } from "@/ds/menu";
import { Page } from "@/ds/page";
import { Section } from "@/ds/section";
import { Segmented } from "@/ds/segmented";
import { Skeleton } from "@/ds/skeleton";
import { Stack } from "@/ds/stack";
import { Stats } from "@/ds/stats";

const RANGES = [7, 30, 90] as const;
const FAMILIES = ["blue", "green", "orange", "purple", "pink", "olive", "yellow"] as const;
const STATES = [
  { key: "running", family: "green" },
  { key: "paused", family: "yellow" },
  { key: "suspended", family: "gray" },
] as const;

export function minutes(m: number, t: TFunction): string {
  if (m < 1) return t("usage.min", { count: 0 });
  if (m < 60) return t("usage.min", { count: Math.round(m) });
  return t("usage.hours", { count: Number((m / 60).toFixed(m < 600 ? 1 : 0)) });
}

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// Compute and activity over a range of days, for everyone or one person.
export function UsagePage() {
  const { t } = useTranslations();
  const [params, setParams] = useSearchParams();
  const days = RANGES.includes(Number(params.get("days")) as never) ? Number(params.get("days")) : 30;
  const by = params.get("by") ?? "";
  const usage = useUsage(days, by);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    return `/usage?${next}`;
  };

  return (
    <Shell rail={false} place="home">
      <Page
        layout="column"
        width="wide"
        head={
          <Head
            title={t("usage.title")}
            icon="server"
            filters={
              <>
                <Menu
                  label={t("usage.person")}
                  align="end"
                  value={by}
                  onPick={(value) => {
                    const next = new URLSearchParams(params);
                    if (value) next.set("by", value);
                    else next.delete("by");
                    setParams(next);
                  }}
                  items={[
                    { label: t("usage.everyone"), value: "", glyph: "member", current: !by },
                    ...(usage.data?.people ?? []).map((p) => ({ label: p, value: p, glyph: "member", current: by === p })),
                  ]}
                  trigger={
                    <Button glyph="member" glyphAfter="chevron-down">
                      {by || t("usage.everyone")}
                    </Button>
                  }
                />
                <Segmented
                  label={t("usage.range")}
                  value={String(days)}
                  items={RANGES.map((r) => ({ value: String(r), label: t("usage.days", { count: r }), href: set("days", r === 30 ? "" : String(r)) }))}
                />
              </>
            }
          />
        }
      >
        {usage.isPending && <Skeleton shape="page" />}
        {usage.isError && <Alert tone="error" title={messageFrom(usage.error, t)} />}
        {usage.data && <Report usage={usage.data} everyone={!by} />}
      </Page>
    </Shell>
  );
}

function Report({ usage, everyone }: { usage: Usage; everyone: boolean }) {
  const { t } = useTranslations();
  const envs = usage.environments.map((e) => e.name);
  const nodes = usage.days.reduce((n, d) => n + d.nodes, 0);
  const stats = [
    { value: minutes(usage.totals.compute_minutes, t), label: t("usage.compute") },
    { value: String(usage.totals.sessions), label: t("usage.sessions") },
    { value: String(usage.totals.pull_requests), label: t("usage.pull_requests") },
    { value: count(usage.totals.tokens), label: t("usage.tokens") },
  ];
  if (everyone) stats.push({ value: minutes(nodes, t), label: t("usage.nodes") });
  if (usage.totals.approvals > 0) stats.push({ value: minutes(usage.totals.approval_wait_ms / 60000, t), label: t("usage.wait", { count: usage.totals.approvals }) });

  return (
    <Stack gap={24}>
      <Stats label={t("usage.title")} items={stats} />
      <Section name={t("usage.compute_title")} text={t("usage.compute_text")}>
        <Box pad={16}>
          <Bars days={usage.days} keys={envs} family={(i) => FAMILIES[i % FAMILIES.length]} value={(d, k) => d.compute[k] ?? 0} unit={(v) => minutes(v, t)} />
          {usage.totals.compute_minutes > 0 && <Legend items={envs.map((e, i) => [e, FAMILIES[i % FAMILIES.length]])} />}
        </Box>
      </Section>
      <Section name={t("usage.states_title")} text={t("usage.states_text")}>
        <Box pad={16}>
          <Bars
            days={usage.days}
            keys={STATES.map((s) => s.key)}
            family={(i) => STATES[i].family}
            value={(d, k) => d.states[k as keyof UsageDay["states"]]}
            unit={(v) => minutes(v, t)}
          />
          {usage.days.some((d) => d.states.running + d.states.paused + d.states.suspended > 0) && (
            <Legend items={STATES.map((s) => [t(`usage.state.${s.key}`), s.family])} />
          )}
        </Box>
      </Section>
      {usage.environments.length > 0 && (
        <Section name={t("usage.env_title")} flush>
          <List
            columns={[t("usage.environment"), [t("usage.compute"), "end"], [t("usage.sessions"), "end"], [t("usage.pull_requests"), "end"], [t("usage.tokens"), "end"]]}
            template="minmax(0, 1fr) 96px 96px 120px 96px"
            label={t("usage.env_title")}
          >
            {usage.environments.map((e, i) => (
              <ListRow
                key={e.name}
                name={
                  <ListName
                    mono
                    title={
                      <>
                        <i className={`swatch fam-${FAMILIES[i % FAMILIES.length]}`} /> {e.name}
                      </>
                    }
                  />
                }
                cells={
                  <>
                    <ListCell align="end">{minutes(e.compute_minutes, t)}</ListCell>
                    <ListCell align="end">{e.sessions}</ListCell>
                    <ListCell align="end">{e.pull_requests}</ListCell>
                    <ListCell align="end">{count(e.tokens)}</ListCell>
                  </>
                }
              />
            ))}
          </List>
        </Section>
      )}
    </Stack>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  if (items.length === 0) return null;
  return (
    <ul className="legend">
      {items.map(([label, family]) => (
        <li key={label}>
          <i className={`swatch fam-${family}`} />
          {label}
        </li>
      ))}
    </ul>
  );
}

// Stacked bars, one per day; the scale rounds up to a clean step.
function Bars({
  days,
  keys,
  family,
  value,
  unit,
}: {
  days: UsageDay[];
  keys: string[];
  family: (i: number) => string;
  value: (d: UsageDay, key: string) => number;
  unit: (v: number) => string;
}) {
  const { t } = useTranslations();
  const totals = days.map((d) => keys.reduce((n, k) => n + value(d, k), 0));
  const top = scale(Math.max(0, ...totals));
  const every = Math.ceil(days.length / 8);
  if (top === 0) return <p className="chart-empty">{t("usage.nothing")}</p>;
  return (
    <div className="chart">
      <div className="grid" aria-hidden>
        {[1, 0.5, 0].map((f) => (
          <span key={f} style={{ bottom: `${f * 100}%` }}>
            {unit(top * f)}
          </span>
        ))}
      </div>
      <div className="bars">
        {days.map((d, i) => (
          <div key={d.day} className="col" title={`${label(d.day)}: ${unit(totals[i])}`}>
            <div className="stack" style={{ height: `${(totals[i] / top) * 100}%` }}>
              {keys.map((k, j) => {
                const v = value(d, k);
                return v > 0 ? <i key={k} className={`fam-${family(j)}`} style={{ flexGrow: v }} /> : null;
              })}
            </div>
            <span className="x">{i % every === 0 ? label(d.day) : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function label(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function scale(max: number) {
  if (max <= 0) return 0;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
}
