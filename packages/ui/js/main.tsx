import "@fontsource-variable/inter";
import "@fontsource-variable/familjen-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../css/tokens.css";
import "../css/base.css";
import "../css/ui.css";
import "../css/shell.css";
import "../css/session.css";
import "../css/usage.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "@/contexts/api/query-client";
import { StreamProvider, useLink } from "@/contexts/api/stream";
import { TranslationsProvider, useTranslations } from "@/contexts/i18n";
import { applyTheme } from "@/shell/shell";
import { Toaster } from "@/ui/toast";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { NewSession } from "@/pages/new";
import { SessionPage } from "@/pages/session";
import { UsagePage } from "@/pages/usage";

applyTheme();

function Reconnecting() {
  const link = useLink();
  const { t } = useTranslations();
  if (link !== "reconnecting") return null;
  return (
    <div className="linkbar" role="status">
      <span className="spin" />
      {t("link.reconnecting")}
    </div>
  );
}

function SignedIn() {
  return (
    <StreamProvider>
      <Reconnecting />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/s/:id/:view?" element={<SessionPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NewSession />
    </StreamProvider>
  );
}

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <TranslationsProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/*" element={<SignedIn />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </QueryClientProvider>
    </TranslationsProvider>
  </StrictMode>,
);
