import { useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslations } from "@/contexts/i18n";
import { signOut, useMe, useSessions } from "@/contexts/api/sessions";
import type { Summary } from "@/contexts/api/types";
import { age } from "@/lib/time";
import { Shell as Frame } from "@/ds/shell";
import { Sidebar } from "@/ds/sidebar";
import type { MenuItem } from "@/ds/menu";

// The frame of every signed-in page, as vrcl's layout: ds Shell with the sidebar, open or as a rail, and the page.
export function Shell({ rail, place, children }: { rail: boolean; place: "home" | "session"; children: ReactNode }) {
  return (
    <Frame height="full" sidebar={<Side rail={rail} place={place} />}>
      {children}
    </Frame>
  );
}

// The sidebar folds to a rail on narrow screens by itself; nothing to open from the head.
export function SideButton() {
  return null;
}

export function useNewSession() {
  const [params, setParams] = useSearchParams();
  return () => {
    const next = new URLSearchParams(params);
    next.set("new", "1");
    setParams(next);
  };
}

const STATE: Record<Summary["state"], "ok" | "busy" | "bad" | "idle"> = {
  forking: "busy",
  running: "busy",
  awaiting_approval: "busy",
  idle: "ok",
  failed: "bad",
};

function Side({ rail, place }: { rail: boolean; place: "home" | "session" }) {
  const { t } = useTranslations();
  const me = useMe();
  const sessions = useSessions();
  const location = useLocation();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const current = location.pathname.match(/^\/s\/([^/]+)/)?.[1];
  const name = me.data?.cluster ?? "hz";
  const pick = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem("hz.theme", next);
    } catch {
      // This page only.
    }
    applyTheme(next);
  };
  const account: MenuItem[] = [
    {
      group: t("side.theme"),
      items: (["system", "light", "dark"] as Theme[]).map((value) => ({
        label: t(`side.themes.${value}`),
        glyph: { system: "window", light: "zap", dark: "hidden" }[value],
        current: theme === value,
        attrs: { onClick: () => pick(value) },
      })),
    },
    "separator",
    { label: t("auth.sign_out"), glyph: "arrow-left", attrs: { onClick: () => signOut() } },
  ];
  return (
    <Sidebar
      key={place}
      collapsed={rail}
      storageKey={`hz.rail.${place}`}
      recent={t("side.recent")}
      empty={t("side.none")}
      workspace={{ name, items: [{ label: t("home.title"), glyph: "session", href: "/", current: location.pathname === "/" }] }}
      places={[
        { label: t("usage.title"), icon: "tier", href: "/usage", active: location.pathname === "/usage" },
        { label: t("llm.title"), icon: "llm", href: "/llm", active: location.pathname.startsWith("/llm") },
      ]}
      sessions={(sessions.data ?? []).slice(0, 30).map((s) => ({
        id: s.id,
        title: s.title ?? s.prompt ?? t("session.untitled"),
        href: `/s/${s.id}`,
        state: STATE[s.state],
        word: t(`state.${s.state}`),
        meta: `${s.env} · ${age(s.last)}`,
        active: current === s.id,
      }))}
      account={{ name: t("side.you"), email: me.data ? `${me.data.cluster}.${me.data.zone}` : undefined, items: account }}
    />
  );
}

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    return (localStorage.getItem("hz.theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;

// As vrcl: a `dark` class on <html>, following the system unless a theme was picked.
export function applyTheme(theme = readTheme()) {
  const on = theme === "dark" || (theme === "system" && !!dark?.matches);
  document.documentElement.classList.toggle("dark", on);
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

dark?.addEventListener("change", () => applyTheme());

