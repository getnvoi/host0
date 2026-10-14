# hz desktop

The macOS app: Tauri v2 around nvoi's design system (`ui/`, from nvoi's `design` branch at 958d5d6c, with nvoix's
composer and new session dialog) and the app in `src/`. It talks to one **hub** and, through it, to the plane of the
workspace in use. This file is the contract the hub and the plane's API rework implement.

```
bun install                                   # at the repository root
VITE_HZ_HUB=https://hub.example bun run build # the web bundle in dist/
bun run e2e                                   # Playwright, headless WebKit, against e2e/hub.ts
bun tauri build --debug --bundles app         # src-tauri/target/debug/bundle/macos/hz.app
```

A build without `VITE_HZ_HUB` starts and says it names no hub.

## The app

- `src-tauri`: the window, the http plugin (requests from Rust, no CORS), deep-link (`hz://`), and four commands:
  `keychain_get|set|delete(account)` (service `hz`, account the hub's host) and `open_url(url)` (http and https only).
- `src/native.ts` is everything the web app asks of Tauri; `e2e/native.ts` replaces it in the e2e build.
- `src/api/client.ts` implements apps/ui's `Transport` (`apps/ui/js/contexts/api/transport.ts`) for the plane through
  the hub: bearer token, fetch-based SSE, sockets by ticket, previews by host.

## Auth

Every request carries `Authorization: Bearer <device token>`. A refusal is a `text/plain` sentence the app shows as is.
A 401 from the hub means the token is gone: the app forgets it and shows sign-in.

| Request | Answer |
|---|---|
| `GET /v1/auth/github?challenge=<b64url sha256(verifier)>&method=S256&state=<random>&redirect=hz://auth` (opened in the browser) | GitHub's sign-in, then `302 hz://auth?code=<one-time code>&state=<state>`, or `hz://auth?error=<reason>&state=<state>` |
| `POST /v1/auth/token` `{"code","verifier"}` | `{"token"}`; 400 when the code was used, expired or does not match the challenge |
| `DELETE /v1/auth/token` | 204; the token stops working |
| `GET /v1/me` | `{"login","name","avatar_url"}` |

## Workspaces

| Request | Answer |
|---|---|
| `GET /v1/workspaces` | `[{"name","plan","location","ready","run"}]`; `ready` is asked of the workspace at the moment of the request; `run` names the provisioning run while one is open, else null |
| `GET /v1/offer` | `{"credit_cents","currency","plans":[{"name","label","cpu","memory","hourly_cents"}],"locations":[{"name","label"}]}` |
| `POST /v1/workspaces` `{"name","plan","location"}` | 201 the workspace, `ready: false`, `run` set; 409 when the name is taken |
| `POST /v1/workspaces/{ws}/runs` | 201 `{"id"}`: provisioning again, from where it stopped |
| `GET /v1/workspaces/{ws}/runs/{run}/stream?from=<n>` | SSE. Each message: `id: <line index>`, `data: {"line":"[3/12] …"}`. The last: `{"line","state":"ok"}`, or `{"line":"<the failed step's own line>","state":"failed"}`, then the stream closes. `from` replays from that line, so leaving and coming back resumes |
| `GET /v1/workspaces/{ws}/repositories` | `{"install_url","repositories":[{"full_name","default_branch","private"}]}`: what the GitHub App reaches |
| `POST /v1/workspaces/{ws}/tickets` | `{"ticket"}`: one use, a minute, for a socket that cannot carry a header |
| `GET /v1/workspaces/{ws}/usage?days=<7\|30\|90>` | the usage report, in the shape of `ui/src/screens/settings/models.ts`' `UsageReport` with dates as ISO strings: the hub bills, so money is its answer |
| `ANY /v1/workspaces/{ws}/plane/<route>` | the plane's `<route>`, as below; 503 with a sentence while the workspace is not ready |

## The plane, through the hub

Today's routes of `cmd/controlplane/http.go`, unchanged, prefixed with `/v1/workspaces/{ws}/plane`:

`GET me`, `GET stream` (SSE, `Last-Event-ID`), `GET sessions`, `POST sessions` `{"env","prompt"}` (an empty prompt
forks and rests), `GET sessions/{id}`, `GET sessions/{id}/queue`, `DELETE sessions/{id}/queue/{i}` `{"text"}`,
`POST sessions/{id}/turns` `{"prompt","to"}`, `POST sessions/{id}/stop`, `DELETE sessions/{id}`,
`GET sessions/{id}/preview`, `POST previews` `{"host"}`, `GET sessions/{id}/changes`, `GET sessions/{id}/terminals`,
`GET sessions/{id}/terminals/{tid}` (websocket), `DELETE sessions/{id}/terminals/{tid}`, `GET approvals?session=`,
`POST approvals/{id}/approve|deny`, `GET environments`, `GET|PUT|DELETE environments/{name}`,
`POST|GET environments/{name}/seed`, `GET cluster/shape`, `GET llm/providers`, `GET|POST llm/configs`,
`PUT|DELETE llm/configs/{name}` (`?remove=1`), `POST llm/configs/{name}/main|restore`.

The agents' keys from onboarding are `POST llm/configs`: `{"name":"Claude","provider":"claude_code","values":{"kind":"api_key"|"oauth","token"}}`
(`oauth` when the value starts with `sk-ant-oat`) and `{"name":"OpenAI","provider":"codex","values":{"kind":"api_key","token"}}`.

## What the plane must add

- `POST environments/propose` `{"repo":"owner/name"}` → an `Environment` (`internal/workspace` JSON) an agent wrote
  from reading the repository; not stored until the `PUT`.
- The terminal socket through the hub: `?ticket=` in place of the cookie (the hub checks it and forwards).
- Preview frames: `frame-ancestors` must admit the app's origin (`tauri://localhost`), not only the app host.
- Choosing the agent of a session: `POST sessions` takes no credential today, so the new session dialog offers the
  main credential alone.

## e2e

`e2e/hub.ts` answers every route above from `e2e/recorded/*.json`, written by hand from the Go types; they are to be
re-recorded from a real hub and plane once the hub exists. The tests drive sign-in through the stub's real 302 and the
app's deep-link hook, the onboarding 1→5, and a session (list, conversation, a streamed event, an approval).
