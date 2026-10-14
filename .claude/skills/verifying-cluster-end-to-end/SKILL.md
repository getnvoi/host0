---
name: verifying-cluster-end-to-end
description: Use when a change to the install, the plane, boxd, the preview gate or the scaler needs proving on a real cluster, or when asked to run, test or demo the seed, fork, preview, agent and approval flow or the idle pause and suspend cycle on Hetzner.
---

# Verifying a cluster end to end

## Overview

The only proof that counts is the real path: Hetzner, k3s, Substrate, the Cloudflare tunnel, dummy-rails. Each stage below has a command and a pass condition; a stage passes only on its measured result, never on "it rolled out".

Every command is `./bin/hz`. No curl, no ssh, no kubectl: a stage that needs something hz does not do is a missing command, written first and then used.

## Prerequisites

- `~/Desktop/ncx/.env` (0600, gitignored): `HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `RAILS_MASTER_KEY`.
- `~/.ssh/nvoi_ed25519`, and `go`, `ko`, `git` on the laptop.
- Every shell starts with:

```sh
cd ~/Desktop/ncx && set -a && . ./.env && set +a
install() { ./bin/hz cluster install dev --zone nvoi.to --ssh-key ~/.ssh/nvoi_ed25519 "$@"; }
plane_up() { for i in $(seq 90); do ./bin/hz me >/dev/null 2>&1 && return; sleep 2; done; return 1; }
```

- Long commands run in the background with a Monitor on their log; report each step as it lands.

## Stages

| # | Command | Passes when |
|---|---|---|
| 1 | `go build -o bin/hz ./cmd/hz`; `go test ./...` | builds, tests pass |
| 2 | `install` | ends with `api at https://api-dev.nvoi.to` |
| 3 | `./bin/hz credentials && ./bin/hz env apply examples/dummy-rails.yml` | no output, exit 0 |
| 4 | `./bin/hz env seed dummy` | `seed ready:` link in about 2 min |
| 5 | Gate: `./bin/hz preview dummy-dev-preview.nvoi.to --check` | `no token 401`, the link sets the cookie, `cookie 200` |
| 6 | Fork: `./bin/hz session start dummy "Reply ok."` | `session <id> on hz/<id>`; `forked in` under 10 s; ends `idle` |
| 7 | `./bin/hz session start dummy "<task that ends in a pull request>"` | calls `set_title`, commits, stops at `awaiting_approval` |
| 8 | `./bin/hz session preview <id>`, then `./bin/hz preview <id>-dev-preview.nvoi.to --check` while it runs | `up true`; the agent's change is live with no restart |
| 9 | `./bin/hz approval ls`, `./bin/hz approval show <id>`, **ask the user**, then on their yes `./bin/hz approval approve <id>` (`deny` otherwise) | PR URL printed, session back to `idle` |
| 10 | Every read the spec has, as JSON (below) | each exits 0 and prints JSON |
| 11 | Idle cycle, below | pause, hold, shrink, suspend, release, resume |
| 12 | Web UI in Chrome: `./bin/hz open`, then start a conversation from the home composer, watch it stream, queue a message while it works, withdraw one, open the preview panel, answer the gate, Stop a running turn | signed in on `app-dev.nvoi.to`; every step shows live without a reload; the reconnecting strip appears only while the stream is down |

Redeploy one step: `install --only "control plane" && plane_up`. `plane_up` gives up after 3 minutes; then read the plane's log: `./bin/hz pods --node <control node>` names its pod, `./bin/hz logs hz-system <pod> --tail 30` prints it.

## Every read, as JSON

Each generated read command takes `-o json` and prints the plane's answer as it is. With a session `$S` and an approval `$A` from the stages above:

```sh
for c in "me" "ls" "env ls" "env status dummy" "llm ls" "llm providers" "session ls" "session show $S" \
  "session queue ls $S" "session preview $S" "session changes $S" "session log ls $S" "session terminal ls $S" \
  "approval ls" "cluster shape" "pods" "browsers"; do
  echo "== hz $c"; ./bin/hz $c -o json >/dev/null || echo "FAILED: hz $c"
done
```

Passes when no line says `FAILED`. A read this list misses is one `hz --help` shows and the spec names under `x-hz` with an output.

## Idle cycle

The pause and suspend thresholds are the plane's `HZ_PAUSE_AFTER` and `HZ_SUSPEND_AFTER` (10 and 60 minutes); hz has no command that shortens them yet, so this stage runs at their length or waits for that command.

```sh
./bin/hz preview <session>-dev-preview.nvoi.to --check   # the activity the timers count from
./bin/hz ls                                              # every 30 s, in a Monitor: pools, workers, the actors they hold
```

Expected, in order: the session's actor paused on its worker with the worker held; its pool shrinks to 0; the actor suspended and the worker released; `--check` again grows the pool and answers 200 (about 6 s from paused, 13 s from suspended).

## Common mistakes

| Symptom | Cause |
|---|---|
| 502 or `unauthorized` right after a redeploy | the plane is restarting; wait for `plane_up` |
| a fork waits for ever | the tier's pool is full and the node cannot grow; Hetzner's dedicated-core limit (8 on a new project) |
| 401 from Cloudflare on `*-preview` hosts | a zone Worker route catches the suffix; the install claims `*<suffix>.<zone>/*` with no Worker |
| seed rerun repeats an old failure | boxd run ids are idempotent; every attempt needs its own id |
| sessions from before a template change cannot resume | their pool or template is gone; reseed, start new sessions |
| an empty plane after a redeploy over an older one | the plane's records are `/var/lib/hz/hz.db`; one from before it starts empty: `hz credentials`, `hz env apply`, `hz env seed` again |

## Cleanup

Only when the user asks, or the cluster is no longer needed: it costs about €0.10 an hour while up. `./bin/hz cluster destroy dev --zone nvoi.to` removes servers, network, firewall, key, tunnel, records and the route claim. Approving in stage 9 opens a real pull request: never without the user's yes.
