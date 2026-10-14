import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "@/contexts/api/query-client";
import { StreamProvider } from "@/contexts/api/stream";
import { TranslationsProvider } from "@/contexts/i18n";
import { Toaster } from "@/ds/toast";
import { HomePage } from "@/pages/home";
import { LoginPage } from "@/pages/login";
import { NewSession } from "@/pages/new";
import { SessionPage } from "@/pages/session";
import { UsagePage } from "@/pages/usage";
import { LlmPage } from "@/pages/llm";
import { LlmFormPage } from "@/pages/llm/form";

// The app without its router, which differs by build: the browser's history, or the desktop's memory.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <TranslationsProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </TranslationsProvider>
  );
}

export function SignedIn() {
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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<SignedIn />} />
    </Routes>
  );
}
