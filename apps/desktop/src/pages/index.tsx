import type { RouteObject } from "react-router-dom";
import { CredentialPage, CredentialsPage } from "./agents/credentials";
import { EnvironmentPage, EnvironmentsPage, NewEnvironmentPage } from "./code/environments";
import { SessionPage } from "./session/session";
import { SessionsPage } from "./session/sessions";
import { UsagePage } from "./settings/usage";

// Every page of the app, by path. Each page loads from its path alone; a session's view is the path's last part.
export const routes: RouteObject[] = [
  { path: "/sessions", element: <SessionsPage /> },
  { path: "/board", element: <SessionsPage board /> },
  { path: "/sessions/:id/:view?", element: <SessionPage /> },
  { path: "/settings/environments", element: <EnvironmentsPage /> },
  { path: "/environments/new", element: <NewEnvironmentPage /> },
  { path: "/environments/:id", element: <EnvironmentPage /> },
  { path: "/settings/credentials", element: <CredentialsPage /> },
  { path: "/credentials/:id", element: <CredentialPage /> },
  { path: "/settings/usage", element: <UsagePage /> },
];
