# nvoi

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
RIGHT   nvoi ls                      # and if it does not exist yet, write it
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
printed `NVOI_TOKEN is required`; four layers above it reported "failed while
waiting for running", and ten minutes went into finding a sentence that had
already been written. If a caller has to go and look, the CLI is missing a
command.

## Modules follow who implements what

```
shared/        names, the api contract                everyone
infra/         the install: interfaces, steps, manifests  local commands only
hetzner/       infra.Cloud
cloudflare/    infra.Edge
controlplane/  the api, sandboxes, turns, approvals   runs in the cluster
cli/           the nvoi binary
```

**A contract lives with its consumer; a provider is its own module.** `infra` declares `Cloud`, `Edge` and
`Shell` and imports no provider; `hetzner` and `cloudflare` implement them and the cli wires them in. The
control plane declares `Sandboxes` and `Runner` the same way; `substrate` and `claude` implement them.

**`controlplane` must not import `infra`.** Anything the control plane needs from the install is in `shared`,
or it does not exist.

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
bcrypt hash, and writes the plaintext to `~/.nvoi/state.json` at 0600. Nobody
chooses a password and nobody types one.

**An absent secret is refused, never waved through.** A reference
implementation returns "authorized" when no password is configured — a
reasonable default for a daemon somebody may run bare, and wrong here: install
always mints one, so an empty hash means something failed, not that this
control plane is open. Refuse with 503 and say it is not installed.

Whoever holds the secret is the operator. That is the model for a box you own;
a shared team UI is a different phase and needs real accounts.

## The database is durability. Live state is fetched.

A row holds what somebody asked for and what only we can know: identity, sealed
credentials, the transcript, a byte cursor, a decision. **It never holds an
observation about the world.** Whether a server exists, whether a pod is
running, whether a checkout landed — those are asked, every time, at the moment
of use.

A stored observation is a cache nobody invalidates, and it lies confidently. A
workspace row said `ready` with no server; a worktree row said `ready` over an
empty checkout. Both times the row won and the turn broke, and the second
mistake was writing a drift report — a whole feature to reconcile a cache that
should not exist.

So there is no `State` column, no `SandboxID`. The namespace is `wt-<slug>` and
the pod is named from it: nothing is stored, so nothing can disagree.

**The corollary is the naming rule below.** You can only refuse to store an id
if you can compute the name.

## Identity

**A name is computed, never discovered.**

```
Prefix(app, env) -> "nvoi-{app}-{env}"
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

**Sweep by owner.** `nvoi/owner` on Kubernetes objects, the same label on cloud
resources. One owner per reconcile step, a closed taxonomy, so a step can only
ever delete its own work. Adding a step is one const — never an exclusion list.
In-cluster that is `ApplyOwned` / `SweepOwned`.

**No tofu.** No HCL, no `terraform-exec`, no state backend, no lock, no binary
downloaded into a cache, no bucket. A self-hoster installs one binary and needs
nothing else. If a converging engine is ever needed, it is because we are
managing infrastructure we did not create — and that is a different product.

## Zero configuration files

The control plane reads no environment variables. Two things live outside the database
because they cannot live inside it:

```
~/.nvoi/key      32 bytes, 0600 — the sealing key, the one thing to back up
~/.nvoi/nvoi.db  SQLite
```

`.env.seed` is read exactly once by `nvoi seed`, sealed into rows, then it is
yours to delete. Nothing reads it at runtime.

Secrets are AES-256-GCM, fresh nonce per seal. A provider declares what it needs
via `Requires() []Requirement`; configs compose secrets by key, so one
credential is one row however many things use it.

---

## The turn

**A turn is not a job.** It is a session running in a Pod, and the Pod holds it.
The agent CLI runs under `sandbox_client`; the control plane is merely the process
ATTACHED — reading the stream, writing rows, answering what it asks. Kill the
control plane and the turn continues; the next reader reattaches at
`Session.Cursor`.

Delivery is at-least-once across two systems with no transaction between them,
so the turn id travels _inside the prompt_ and the Pod's own log is the dedupe
store. On reattach: read before writing.

Exactly one reader per session. Postgres decides at scale; a process-local mutex
decides on one box. Same interface either way.

---

## Boundaries

The clone happens on the control plane and travels in as a tar, so `git push` from inside
a Pod must fail — that is the boundary working, not a bug. Tools are served
_inverted_ over the pipe, so no nvoi token is in the Pod's environ. The LLM key
is the one necessary exception, and it is pinned by egress to one host.

One namespace per worktree, from day one, even with one worktree.

---

## Working here

```
go build -C packages/cli -o ../../bin/nvoi ./cmd/nvoi
go test -C packages/infra ./...
```

Nothing is stubbed. Third parties are mocked from captured real responses, never from invented ones.
