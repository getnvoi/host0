# h0

Coding agents on a cluster you own: k3s on Hetzner, Agent Substrate for sandboxes, a Cloudflare tunnel for
previews. A seed sandbox runs the app; every task forks it, gets a preview URL, and asks before it acts outside.

---

## THE RULE

**Never exercise anything but ours.**

If you are about to type something our CLI does not provide, stop: that is not a
shortcut, it is a missing feature. Add the command, then use it.

No raw `curl`. No raw `ssh`. No `kubectl`. No `hcloud`. No `tofu` by hand. No
one-off scripts. No poking the API "just to check". Every one of those is a
report against our own product, written in the wrong place.

The only shell you run is `bin/dev`, and everything it invokes is code in this
repository.

```
WRONG   curl -H "Authorization: Bearer $TOKEN" https://api.hetzner.cloud/v1/servers
RIGHT   h0 ls                      # and if it does not exist yet, write it
```

This is not process hygiene. It is how the surface gets defined: the product
ends up being exactly what was actually needed, and it is proven by having been
used. A feature nobody reached for does not exist; a workaround nobody wrote
down is a hole.

The corollary: when something is broken, you fix it in the code and re-run the
command. You never hand-fix the cluster, the cloud account, or the database.
A repaired-by-hand system is one whose next run does something different.

---

## Comments

**Comments define what IS. They are never history.**

Never name what is not here. "This used to be X", "ported from Y", "replaces Z",
"we deleted", "the first draft" — all of it is noise that grows forever and is
wrong the moment it is written. Git holds the history; the code holds the
definition. Present tense, always.

**Hard limits.** No comment exceeds 3 lines or 200 characters. Ever. A comment
longer than the code under it is deleted, not shortened.

- File or type header: 1-3 lines. Function or constant: 0-2, usually 0.
- No ASCII banners. No ALL-CAPS emphasis. No changelog.
- No arguments about designs not taken. No restating the code in prose.
- Never two consecutive comment paragraphs.

A comment earns its place only by saying what the code cannot: a non-obvious
why, a constraint, an invariant, a unit, a bug it guards against.

```
// The cli adds `mcp__<server>__` itself; this strips it on the way back in.
func bare(name string) string { return strings.TrimPrefix(name, prefix) }
```

**Never cite what you have not opened.** If a comment names a path, symbol or
number, verify it in the same edit. A wrong comment is worse than none: length
reads as authority and nobody checks.

## A title names the thing, it does not argue about it

An issue title and a commit subject are index entries. Somebody scanning forty
of them is looking for a symbol, a file, or a verb.

```
WRONG   Scaling a workspace's cluster has no home, and the join token is why
RIGHT   Scale-out is unwired: JoinWorker and JoinSecondaryMaster have no caller
```

Name what is broken and where. No thesis, no reversal, no clause that exists
for its rhythm — the argument goes in the body, where somebody who already
decided to read it will find it. A title built for effect hides the one word
that would have been searched for, and it reads as stale the moment the code
moves under it.

## Failure is loud, or it is not failure

**Silence is the signal, not the clock.** Ten seconds with no output is a hang
and the process group is killed. A wall-clock timeout is a guess that is both
too short for real work and too long to notice a stall.

**One byte on stderr is a failure.** Two seconds to collect the rest of the
message, then the group dies. Nothing "probably recovers".

**Every run is logged while it streams.** There is no run whose output existed
only in a terminal.

**Retries are bounded and end in a row.** A reader that backs off for ever is a
caller waiting on nothing. Four attempts, then the session is `failed` with the
reason written where the client already looks.

**A heartbeat that only says "still" is a hang with a clock on it.** Every beat
asks the row what is actually happening and reports it.

**Never swallow. Raise where the requirement is not met.** `_ = err`, an
`if err == nil` that quietly carries on, a decode failure returned as an empty
list — each one moves the report away from the place that knows why. A list we
cannot read is not an empty list: returning nil there says "no command is
running", and the caller answers that by starting a second model over one
checkout.

**An error carries the sentence the failing thing already wrote.** `sandbox_client`
printed `H0_TOKEN is required`; four layers above it reported "failed while
waiting for running", and ten minutes went into finding a sentence that had
already been written. If a caller has to go and look, the CLI is missing a
command.

## Packages follow who implements what

One module, `github.com/getnvoi/host0`, one `go.mod` at the root.

```
cmd/h0/               the CLI: commands, ~/.h0                                  the laptop
cmd/controlplane/     the plane: HTTP API, usage, cluster status, UI, wiring     runs in the cluster
cmd/boxd/             commands and their durable output in each actor            runs in the cluster
cmd/proxy/            TLS for the public edge, every request to the plane        runs in the cluster
internal/workspace/   environments, seeds, sessions, turns, queues, approvals, LLM configs, changes, logs
internal/auth/        sign-in links, cookies, the bearer token
internal/tools/       the tools the agent sees, one file each
internal/workers/     pools and worker servers, the idle pause and suspend
internal/preview/     preview tokens and the page bridge
internal/stream/      the event broker
internal/infra/       the install: steps, manifests                              cmd/h0/local only
internal/sandbox/     contract: Sandboxes, tiers, the shape; substrate/
internal/llm/         contract: Runner; claude/, codex/
internal/scm/         contract: Forge; github/
internal/db/          contract: the workspace models; GORM on SQLite encrypted at rest, sealed secrets
internal/edge/        contract: the install's Edge, the plane's Router; cloudflare/, dns/
internal/cloud/       contract: Cloud; conformance/, hetzner/, scaleway/, clouds/
internal/box/         client: boxd, and the terminal relay
internal/kube/        client: the cluster's own API
internal/api/         client: the plane's OpenAPI spec and its generated client; h0gen/ writes h0's commands
internal/shared/      naming, seal, mask
apps/ui/              the web UI, built into cmd/controlplane/web/dist
```

A binary's own code lives entirely in `cmd/<binary>`. `internal/` holds only what features, contracts, clients
or several binaries use.

**Dependencies point one way.** `layout_test.go` at the root enforces these on every import, tests included:

1. `cmd/*` may import anything in `internal/`; nothing imports `cmd/`.
2. A feature (`workspace`, `auth`, `tools`, `workers`, `preview`, `stream`, `infra`) imports only contracts (the
   package itself, never a subfolder), clients and `shared`. Never another feature, never an implementation.
3. A contract (`sandbox`, `llm`, `scm`, `edge`, `cloud`, `db`) imports only `shared`.
4. An implementation (any subfolder of a contract) imports only its own contract, `shared` and its own
   subpackages; a provider's tests may import `cloud/conformance`.
5. A client (`box`, `kube`, `api`) imports only `shared` and contracts.
6. `shared` imports nothing of ours.
7. `internal/infra` is imported by `cmd/h0/local` alone.
8. Nothing imports `internal/store`: the plane's records are rows in `internal/db`.

**A type that crosses lives in the contract; an interface lives with its consumer.** `workspace` declares
`Workers`, `Tools` and `Bus`, `infra` declares `Laptop`, `workers` declares `Pools`; `cmd/controlplane` and
`cmd/h0` wire the features into each other. An exception the rules cannot avoid is an entry in the test's
allow-list, with its reason.

**A contract with several providers carries its conformance suite.** Each provider under `cloud/` passes
`cloud/conformance` against a cassette recorded from a real run.

## Self-hosting is a mode, not a leftover

A cluster installed with `h0 cluster install` on the operator's own cloud account, managed with `h0` and the web
UI, works with no hub. The hub is one more client of the plane's API and one more caller of `infra`; it never
becomes something the plane needs.

- The plane imports nothing of the hub and calls it for nothing: no sign-in, licence check or heartbeat.
- What the hub adds (accounts, billing, server-side provisioning) sits beside the plane, not inside it.
- A feature built for the hub that the plane needs gets a self-hosted path in the same change.
- The end-to-end check (`.claude/skills/verifying-cluster-end-to-end`) runs self-hosted, and passes before a hub
  change merges.

## Two kinds of command, and no command is both

**Local** — `install` and `destroy`. They do the work themselves because there
is no control plane yet, or there is about to not be one. Only these may import
`infra`, read a cloud credential, or open ssh.

**Remote** — everything else. A thin client over the control plane:
`client.Client`, a bearer token, and nothing else.

A remote command reaching for a cloud credential is a bug. A local command that
needs the control plane running is a bootstrap that cannot bootstrap.

The split is inherent — the thing being installed cannot install itself — so it
is named rather than removed. Keeping the bootstrap in `infra` with the cli as a
thin adapter is also what lets a hosted install run it server-side later.

## A control plane with no secret does not serve

`install` mints a 32-byte secret, deploys the control plane holding only its
bcrypt hash, and writes the plaintext to `~/.h0/state.json` at 0600. Nobody
chooses a password and nobody types one.

**An absent secret is refused, never waved through.** A reference
implementation returns "authorized" when no password is configured — a
reasonable default for a daemon somebody may run bare, and wrong here: install
always mints one, so an empty hash means something failed, not that this
control plane is open. Refuse with 503 and say it is not installed.

Whoever holds the secret is the operator. That is the model for a box you own;
a shared team UI is a different phase and needs real accounts.

## The database is durability. Live state is fetched.

The plane's records are rows of `internal/db`: environments with their variables, secrets, setup steps and
services; one seed row per build; sessions, their events and their queue; approvals; agent credentials and the
workspace's own; members. Migrations are numbered and frozen: a model that changes gets the next one.

A row holds what somebody asked for and what only we can know: identity, sealed
credentials, the transcript, a decision. **It never holds an observation about the
world.** Whether a server exists, whether a pod is running, whether a checkout
landed — those are asked, every time, at the moment of use.

A stored observation is a cache nobody invalidates, and it lies confidently. A
workspace row said `ready` with no server; a worktree row said `ready` over an
empty checkout. Both times the row won and the turn broke.

So there is no `SandboxID`: a session's actor is `wt-<id>`, computed. **Events are
append-only**: a plane that follows a turn again reads its log from the start and
appends only what is past the stored events. A removed session is soft-deleted and
keeps its events; its environment, removed after, is archived, and declaring the
name again brings it back.

**The corollary is the naming rule below.** You can only refuse to store an id
if you can compute the name.

## Identity

**A name is computed, never discovered.**

```
Prefix(app, env) -> "h0-{app}-{env}"
```

Same inputs, same names, same resources. There is nothing to look up, nothing to
cache, and no "does it already exist" branch. Idempotency is a consequence of
naming, not a technique layered on top of it.

**An IP is a lookup result, never an identity.** Nothing is addressed by
address. Do not store one, do not pass one between steps, do not write one into
a file. Resolve it at the moment of use, from the name.

Corollary: no UUIDs for anything a person or a re-run has to find again.

---

## Infrastructure is described, then converged

We do not call APIs in sequence and record what happened. We declare the state
we want and make the world match it, as many times as we like.

```
rows -> desired names -> converge
```

**The schema is the model.** There is no deploy descriptor and no config struct
describing infrastructure — a workspace, a worktree and a secret are rows, and
the desired world is computed from them.

**The name is the key, so there is nothing to persist.** Compute the desired set
of names, ask the provider what exists under them, make the difference
disappear. No state file. No stored external IDs. No `/tmp` scratch. No IP
carried between steps. Re-running is a no-op, and a resource somebody deleted by
hand comes back on the next run.

Hetzner, Cloudflare and Kubernetes all resolve by name or label, which is what
makes this possible without an engine underneath us.

**Sweep by owner.** `h0/owner` on Kubernetes objects, the same label on cloud
resources. One owner per reconcile step, a closed taxonomy, so a step can only
ever delete its own work. Adding a step is one const — never an exclusion list.
In-cluster that is `ApplyOwned` / `SweepOwned`.

**No tofu.** No HCL, no `terraform-exec`, no state backend, no lock, no binary
downloaded into a cache, no bucket. A self-hoster installs one binary and needs
nothing else. If a converging engine is ever needed, it is because we are
managing infrastructure we did not create — and that is a different product.

## Where things live

The plane's records are `/var/lib/h0/h0.db` on the control node, its `-wal` and `-shm` beside it and nothing
else in that directory: SQLite, the whole file encrypted (AES-256-XTS under a key derived from the sealing key),
secrets sealed again in their columns. Its settings are the environment its Deployment sets at install
(`H0_CLUSTER`, `H0_ZONE`, `H0_EDGE`, …) and the secrets mounted beside them;
nobody edits them by hand, `h0 cluster install` writes them again.

The laptop keeps three things:

```
~/.h0/key           32 bytes, 0600 — the sealing key, the one thing to back up
~/.h0/state.json    where the plane is and the token it takes
~/.h0/certs/<zone>  development only: a kept certificate, sealed with ~/.h0/key
```

`cluster.yml` is optional: every field is also a flag.

A sealed column is AES-256-GCM, a fresh 12-byte nonce per seal, `h0-sealed:1:` then
base64(nonce|ciphertext); one that does not open is an error naming its table and
column. The key is minted by the first install and kept in
two places: the `plane` secret's `seal`, which the plane mounts at `/etc/h0/seal`,
and `~/.h0/key`. An install restores whichever is missing and refuses when they
differ; `h0 cluster destroy` leaves `~/.h0/key` in place. k3s encrypts secrets at
rest in its datastore.

---

## The turn

**A turn is not a job.** It is a session running in a Pod, and the Pod holds it.
The agent CLI runs under `sandbox_client`; the control plane is merely the process
ATTACHED — reading the stream, writing rows, answering what it asks. Kill the
control plane and the turn continues; the next reader reads the turn's log from
its start and appends only the events past those stored.

Delivery is at-least-once across two systems with no transaction between them,
so the turn id travels _inside the prompt_ and the Pod's own log is the dedupe
store. On reattach: read before writing.

Exactly one reader per session. Postgres decides at scale; a process-local mutex
decides on one box. Same interface either way.

---

## Boundaries

The clone happens on the control plane and travels in as a tar, so `git push` from inside
a Pod must fail — that is the boundary working, not a bug. Tools are served
_inverted_ over the pipe, so no h0 token is in the Pod's environ. The LLM key
is the one necessary exception, and it is pinned by egress to one host.

One namespace per worktree, from day one, even with one worktree.

---

## Working here

```
go build -o bin/h0 ./cmd/h0
go test ./...
```

Nothing is stubbed. Third parties are mocked from captured real responses, never from invented ones.

A person never runs against a stub. Development is the real path on the development zone (hostzero.app): the real
hub, the real GitHub App, real provisioning, real keys. Test doubles such as apps/desktop/e2e/hub.ts live inside
automated tests only; when the real piece does not exist yet, say so instead of starting the double.
