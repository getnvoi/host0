---
name: verifying-cluster-end-to-end
description: Use when a change to the install, the plane, boxd, the preview gate or the scaler needs proving on a real cluster, or when asked to run, test or demo the seed, fork, preview, agent and approval flow or the idle pause and suspend cycle on Hetzner.
---

# Verifying a cluster end to end

## Overview

The only proof that counts is the real path: Hetzner, k3s, Substrate, the Cloudflare tunnel, dummy-rails. Each stage below has a command and a pass condition; a stage passes only on its measured result, never on "it rolled out".

Every command is `./bin/h0`. No curl, no ssh, no kubectl: a stage that needs something h0 does not do is a missing command, written first and then used.

## Prerequisites

- `~/Desktop/ncx/.env.development` (0600, gitignored), whose `CLOUDFLARE_API_TOKEN` holds the test zone nvoi.to; `.env.production` holds host0.dev's, the SaaS's own zone, never used for a validation run. Both have `HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `RAILS_MASTER_KEY`.
- `~/.ssh/nvoi_ed25519`, and `go`, `ko`, `git` on the laptop.
- Every shell starts with:

```sh
cd ~/Desktop/ncx && set -a && . ./.env.development && set +a
install() { ./bin/h0 cluster install dev --zone nvoi.to --ssh-key ~/.ssh/nvoi_ed25519 "$@"; }
plane_up() { for i in $(seq 90); do ./bin/h0 me >/dev/null 2>&1 && return; sleep 2; done; return 1; }
```

- Long commands run in the background with a Monitor on their log; report each step as it lands.

## Stages

| # | Command | Passes when |
|---|---|---|
| 1 | `go build -o bin/h0 ./cmd/h0`; `go test ./...` | builds, tests pass |
| 2 | `install` | ends with `api at https://api-dev.nvoi.to` |
| 3 | `./bin/h0 credentials && ./bin/h0 env apply examples/dummy-rails.yml` | no output, exit 0 |
| 4 | `./bin/h0 env seed dummy` | `seed ready:` link in about 2 min |
| 5 | Gate, with the link h0 printed and nothing else: `./bin/h0 preview "<the seed ready: link from stage 4>" --check` right after stage 4, and with each session's `preview` link from `session start` | `no token 401`, the link sets the cookie, `cookie 200` |
| 6 | Fork: `./bin/h0 session start dummy "Reply ok."` | `session <id> on h0/<id>`; `forked in` under 10 s; ends `idle` |
| 7 | `./bin/h0 session start dummy --agent gitops "<task that ends in a pull request>"` | calls `session_title` and `session_push` at once, stops at `awaiting_approval` on `session_pr`; the agent sees only gitops's six tools |
| 8 | `./bin/h0 cluster db` | `ok true`: `plain` and `foreign` empty, `found 0` of `markers`, `sealed` counted and `unsealed` empty |
| 9 | Search: `./bin/h0 search "<a word from stage 7's prompt>"` | a row names stage 7's session, the word in `**` in its snippet |
| 10 | `./bin/h0 session preview <id>`, then `./bin/h0 preview "<the session's printed preview link>" --check` while it runs | `up true`; the agent's change is live with no restart |
| 11 | `./bin/h0 approval ls`, `./bin/h0 approval show <id>`, then `./bin/h0 approval approve <id>` without asking | PR URL printed, session back to `idle` |
| 12 | Every read the spec has, as JSON (below) | each exits 0 and prints JSON |
| 13 | Idle cycle, below | pause, hold, shrink, suspend, release, resume |
| 14 | Web UI in Chrome: `./bin/h0 open`, then start a conversation from the home composer, watch it stream, queue a message while it works, withdraw one, open the preview panel, answer the gate, Stop a running turn | signed in on `app-dev.nvoi.to`; every step shows live without a reload; the reconnecting strip appears only while the stream is down |

Redeploy one step: `install --only "control plane" && plane_up`. `plane_up` gives up after 3 minutes; then read the plane's log: `./bin/h0 pods --node <control node>` names its pod, `./bin/h0 logs h0-system <pod> --tail 30` prints it.

## Every read, as JSON

Stage 5 runs on the seed's host on every run, including the first one after a destroy and install: an environment's host is the same name every time, a session's is new. The check takes the link exactly as h0 printed it, in the order a person would open it: no host written by hand, no link minted again, no retry until it passes. A step that only passes when forced is a failure of the flow, and is reported as one. A `no such host` there fails the stage: record `./bin/h0 cluster records` beside it, run the check again on a session's host, and report both; it is not explained away.

Each generated read command takes `-o json` and prints the plane's answer as it is. With a session `$S` and an approval `$A` from the stages above:

```sh
for c in "me" "ls" "env ls" "env status dummy" "llm ls" "llm providers" "session ls" "session show $S" \
  "session queue ls $S" "session preview $S" "session changes $S" "session log ls $S" "session terminal ls $S" \
  "approval ls" "approval show $A" "cluster shape" "cluster db" "pods" "browsers" "agent ls" "agent show gitops" "usage" \
  "credentials ls" "search ok"; do
  echo "== h0 $c"; ./bin/h0 ${=c} -o json | python3 -c 'import json,sys; json.load(sys.stdin)' || echo "FAILED: h0 $c"
done
```

`${=c}` splits the command under zsh, the shell here; a bare `$c` passes it as one word and every read fails.

Passes when no line says `FAILED`. A read this list misses is one `h0 --help` shows and the spec names under `x-h0` with an output.

## Idle cycle

The pause and suspend thresholds are the cluster's `actors: { pause, suspend }` (or `--pause-after`, `--suspend-after`; 10 and 60 minutes by default); set them short in the cluster file for this stage.

```sh
./bin/h0 preview <session>-dev-preview.nvoi.to --check   # the activity the timers count from
./bin/h0 ls                                              # every 30 s, in a Monitor: pools, workers, the actors they hold
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
| an empty plane after a redeploy over an older one | the plane's records are `/var/lib/h0/h0.db`; one from before it starts empty: `h0 credentials`, `h0 env apply`, `h0 env seed` again |

## Cleanup

Only when the user asks, or the cluster is no longer needed: it costs about €0.10 an hour while up. `./bin/h0 cluster destroy dev --zone nvoi.to` removes servers, network, firewall, key, tunnel, records and the route claim. Approving in stage 11 opens a real pull request on `benbonnet/dummy-rails`, a throwaway repository kept for this check: approve it, and any other approval a validation run raises, without asking the user.
