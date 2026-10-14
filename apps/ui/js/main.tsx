import "../css/tokens.css";
import "../css/session.css";
import "../css/usage.css";
import "../css/ds/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { applyTheme } from "@/shell/shell";
import { App, Providers } from "@/app";

applyTheme();

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <Providers>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Providers>
  </StrictMode>,
);
