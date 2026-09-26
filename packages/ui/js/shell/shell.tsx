import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChartColumn, Check, ChevronsUpDown, LogOut, Monitor, Moon, PanelLeft, PanelLeftClose, PanelLeftOpen, Sun, UserRound } from "lucide-react";
import { useTranslations, type TFunction } from "@/contexts/i18n";
import { signOut, useMe, useSessions } from "@/contexts/api/sessions";
import type { Summary } from "@/contexts/api/types";
import { byDay } from "@/lib/days";
import { age } from "@/lib/time";
import { Sheet } from "@/ui/dialog";
import { Menu } from "@/ui/menu";
import { Dot, Face, tone } from "@/ui/marks";

const Side = createContext<{ open: () => void }>({ open: () => {} });

// The frame of every signed-in page: the sidebar, open or as a rail, and the page. Under 768px the sidebar
// leaves the frame and opens as a sheet from the head.
export function Shell({ rail: railByDefault, place, children }: { rail: boolean; place: "home" | "session"; children: ReactNode }) {
  const key = `nvoi.rail.${place}`;
  const [rail, setRail] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? railByDefault : v === "1";
    } catch {
      return railByDefault;
    }
  });
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  useEffect(() => setSheet(false), [location.pathname]);
  const toggle = () => {
    setRail(!rail);
    try {
      localStorage.setItem(key, rail ? "0" : "1");
    } catch {
      // Remembered for this page only.
    }
  };
  const { t } = useTranslations();
  return (
    <Side.Provider value={{ open: () => setSheet(true) }}>
      <div className="shell">
        <Sidebar rail={rail} onToggle={toggle} />
        <main className="page">{children}</main>
      </div>
      {sheet && (
        <Sheet side="left" width={280} label={t("side.label")} onClose={() => setSheet(false)}>
          <Sidebar rail={false} />
        </Sheet>
      )}
    </Side.Provider>
  );
}

export function SideButton() {
  const { open } = useContext(Side);
  const { t } = useTranslations();
  return (
    <button type="button" className="btn ghost icon phone-only" aria-label={t("side.open")} onClick={open}>
      <PanelLeft />
    </button>
  );
}

export function useNewSession() {
  const [params, setParams] = useSearchParams();
  return () => {
    const next = new URLSearchParams(params);
    next.set("new", "1");
    setParams(next);
  };
}

function dayLabel(age: number, key: string, t: TFunction) {
  if (age === 0) return t("days.today");
  if (age === 1) return t("days.yesterday");
  if (age < 7) return t("days.ago", { count: age });
  return new Date(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function Sidebar({ rail, onToggle }: { rail: boolean; onToggle?: () => void }) {
  const { t } = useTranslations();
  const me = useMe();
  const sessions = useSessions();
  const location = useLocation();
  const name = me.data?.cluster ?? "nvoi";
  const recent = (sessions.data ?? []).slice(0, 30);
  const current = location.pathname.match(/^\/s\/([^/]+)/)?.[1];
  const tip = (s: string) => (rail ? s : undefined);

  return (
    <aside className={`side${rail ? " rail" : ""}`} aria-label={t("side.label")}>
      <div className="side-head">
        {!rail && (
          <Link to="/" className="side-btn" aria-current={location.pathname === "/" ? "page" : undefined} title={t("home.title")}>
            <span className="tile">{name.slice(0, 1)}</span>
            <span className="nm">{name}</span>
          </Link>
        )}
        {onToggle && (
          <button type="button" className="btn ghost icon" aria-label={t(rail ? "side.expand" : "side.collapse")} title={t(rail ? "side.expand" : "side.collapse")} aria-expanded={!rail} onClick={onToggle}>
            {rail ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        )}
        {rail && !onToggle && (
          <Link to="/" className="tile" title={t("home.title")}>
            {name.slice(0, 1)}
          </Link>
        )}
      </div>
      <nav className="places" aria-label={t("side.pages")}>
        <Link to="/usage" className="place" aria-current={location.pathname === "/usage" ? "page" : undefined} title={tip(t("usage.title"))}>
          <ChartColumn />
          <span className="lbl">{t("usage.title")}</span>
        </Link>
      </nav>
      <div className="recent">
        <div className="recent-head">
          <span className="lbl">{t("side.recent")}</span>
        </div>
        <nav className="recent-rows" aria-label={t("side.sessions")}>
          {sessions.isSuccess && recent.length === 0 && <p className="recent-empty lbl">{t("side.none")}</p>}
          {byDay(recent).map((day) => (
            <RecentDay key={day.key} label={dayLabel(day.age, day.key, t)} sessions={day.sessions} current={current} rail={rail} />
          ))}
        </nav>
      </div>
      <div className="side-foot">
        <Account rail={rail} />
      </div>
    </aside>
  );
}

function RecentDay({ label, sessions, current, rail }: { label: string; sessions: Summary[]; current?: string; rail: boolean }) {
  const { t } = useTranslations();
  return (
    <>
      <span className="recent-day">{label}</span>
      {sessions.map((s) => {
        const title = s.title ?? s.prompt ?? t("session.untitled");
        return (
          <Link key={s.id} to={`/s/${s.id}`} className="srow" aria-current={current === s.id ? "page" : undefined} title={rail ? title : undefined}>
            <Dot tone={tone(s.state)} label={t(`state.${s.state}`)} />
            <span className="tx lbl">
              <span className="st">{title}</span>
              <span className="sm">
                {s.env} · {age(s.last)}
              </span>
            </span>
          </Link>
        );
      })}
    </>
  );
}

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    return (localStorage.getItem("nvoi.theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme = readTheme()) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

function Account({ rail }: { rail: boolean }) {
  const { t } = useTranslations();
  const me = useMe();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const pick = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem("nvoi.theme", next);
    } catch {
      // This page only.
    }
    applyTheme(next);
  };
  const themes: [Theme, typeof Sun][] = [
    ["system", Monitor],
    ["light", Sun],
    ["dark", Moon],
  ];
  return (
    <Menu
      label={t("side.account")}
      side="top"
      trigger={({ toggle, ...aria }) => (
        <button type="button" className="side-btn" onClick={toggle} title={rail ? t("side.you") : undefined} {...aria}>
          <Face icon={UserRound} family="purple" />
          <span className="me lbl">
            <b>{t("side.you")}</b>
            <small>{me.data ? `${me.data.cluster}.${me.data.zone}` : "…"}</small>
          </span>
          <ChevronsUpDown />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">{t("side.theme")}</div>
          {themes.map(([value, Icon]) => (
            <button key={value} type="button" role="menuitemradio" aria-checked={theme === value} className="menu-item" onClick={() => pick(value)}>
              <Icon />
              <span>{t(`side.themes.${value}`)}</span>
              {theme === value ? <Check width={14} height={14} /> : <span />}
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => (close(), signOut())}>
            <LogOut />
            <span>{t("auth.sign_out")}</span>
            <span />
          </button>
        </>
      )}
    </Menu>
  );
}
