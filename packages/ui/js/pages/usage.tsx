import { Link, useSearchParams } from "react-router-dom";
import { ChartColumn, CircleAlert, UserRound } from "lucide-react";
import { useTranslations, type TFunction } from "@/contexts/i18n";
import { messageFrom } from "@/contexts/api/errors";
import { useUsage } from "@/contexts/api/sessions";
import type { Usage, UsageDay } from "@/contexts/api/types";
import { Alert, Skeleton } from "@/ui/bits";
import { Face } from "@/ui/marks";
import { Shell, SideButton } from "@/shell/shell";

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
      <header className="bar">
        <div className="bar-lead">
          <SideButton />
          <Face icon={ChartColumn} family="orange" size={28} />
          <h1 className="bar-title">{t("usage.title")}</h1>
        </div>
        <span />
        <div className="bar-end">
          <label className="picker">
            <UserRound />
            <select aria-label={t("usage.person")} value={by} onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set("by", e.target.value);
                else next.delete("by");
                setParams(next);
              }}>
              <option value="">{t("usage.everyone")}</option>
              {(usage.data?.people ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <nav className="seg" aria-label={t("usage.range")}>
            {RANGES.map((r) => (
              <Link key={r} to={set("days", r === 30 ? "" : String(r))} aria-current={days === r ? "page" : undefined}>
                <span>{t("usage.days", { count: r })}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="page-scroll">
        <div className="usage">
          {usage.isPending && <Skeleton rows={6} />}
          {usage.isError && <Alert icon={CircleAlert} title={messageFrom(usage.error, t)} />}
          {usage.data && <Report usage={usage.data} everyone={!by} />}
        </div>
      </div>
    </Shell>
  );
}

function Report({ usage, everyone }: { usage: Usage; everyone: boolean }) {
  const { t } = useTranslations();
  const envs = usage.environments.map((e) => e.name);
  const nodes = usage.days.reduce((n, d) => n + d.nodes, 0);
  const stats: [string, string, string?][] = [
    [minutes(usage.totals.compute_minutes, t), t("usage.compute")],
    [String(usage.totals.sessions), t("usage.sessions")],
    [String(usage.totals.pull_requests), t("usage.pull_requests")],
    [count(usage.totals.tokens), t("usage.tokens")],
  ];
  if (everyone) stats.push([minutes(nodes, t), t("usage.nodes")]);
  if (usage.totals.approvals > 0) stats.push([minutes(usage.totals.approval_wait_ms / 60000, t), t("usage.wait", { count: usage.totals.approvals })]);

  return (
    <>
      <div className="stats">
        {stats.map(([value, label]) => (
          <div key={label} className="stat">
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="day" aria-label={t("usage.compute_title")}>
        <h2 className="tab">{t("usage.compute_title")}</h2>
        <div className="rows chart-box">
          <p className="caption">{t("usage.compute_text")}</p>
          <Bars days={usage.days} keys={envs} family={(i) => FAMILIES[i % FAMILIES.length]} value={(d, k) => d.compute[k] ?? 0} unit={(v) => minutes(v, t)} />
          {usage.totals.compute_minutes > 0 && <Legend items={envs.map((e, i) => [e, FAMILIES[i % FAMILIES.length]])} />}
        </div>
      </section>
      <section className="day" aria-label={t("usage.states_title")}>
        <h2 className="tab">{t("usage.states_title")}</h2>
        <div className="rows chart-box">
          <p className="caption">{t("usage.states_text")}</p>
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
        </div>
      </section>
      {usage.environments.length > 0 && (
        <section className="day" aria-label={t("usage.env_title")}>
          <h2 className="tab">{t("usage.env_title")}</h2>
          <div className="rows">
            <div className="erow head">
              <span>{t("usage.environment")}</span>
              <span>{t("usage.compute")}</span>
              <span>{t("usage.sessions")}</span>
              <span>{t("usage.pull_requests")}</span>
              <span>{t("usage.tokens")}</span>
            </div>
            {usage.environments.map((e, i) => (
              <div key={e.name} className="erow">
                <span className="env">
                  <i className={`swatch fam-${FAMILIES[i % FAMILIES.length]}`} />
                  <span className="mono truncate">{e.name}</span>
                </span>
                <span>{minutes(e.compute_minutes, t)}</span>
                <span>{e.sessions}</span>
                <span>{e.pull_requests}</span>
                <span>{count(e.tokens)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
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
