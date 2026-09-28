import "../css/tokens.css";
import "../css/session.css";
import "../css/usage.css";
import "../css/ds/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "@/contexts/api/query-client";
import { StreamProvider } from "@/contexts/api/stream";
import { TranslationsProvider } from "@/contexts/i18n";
import { applyTheme } from "@/shell/shell";
import { Toaster } from "@/ds/toast";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { NewSession } from "@/pages/new";
import { SessionPage } from "@/pages/session";
import { UsagePage } from "@/pages/usage";
import { LlmPage } from "@/pages/llm";
import { LlmFormPage } from "@/pages/llm/form";

applyTheme();

function SignedIn() {
  return (
    <StreamProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/s/:id/:view?" element={<SessionPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/llm" element={<LlmPage />} />
        <Route path="/llm/new" element={<LlmFormPage />} />
        <Route path="/llm/:name" element={<LlmFormPage />} />
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
