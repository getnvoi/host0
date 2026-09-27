---
name: verifying-cluster-end-to-end
description: Use when a change to the install, the plane, boxd, the preview gate or the scaler needs proving on a real cluster, or when asked to run, test or demo the seed, fork, preview, agent and approval flow or the idle pause and suspend cycle on Hetzner.
---

# Verifying a cluster end to end

## Overview

The only proof that counts is the real path: Hetzner, k3s, Substrate, the Cloudflare tunnel, dummy-rails. Each stage below has a command and a pass condition; a stage passes only on its measured result, never on "it rolled out".

## Prerequisites

- `~/Desktop/ncx/.env` (0600, gitignored): `HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `RAILS_MASTER_KEY`.
- `~/.ssh/nvoi_ed25519`, and `go`, `ko`, `git` on the laptop.
- Every shell starts with these helpers:

```sh
cd ~/Desktop/ncx && set -a && . ./.env && set +a
IP=$(curl -s -H "Authorization: Bearer $HCLOUD_TOKEN" "https://api.hetzner.cloud/v1/servers?name=hz-dev-control" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["servers"][0]["public_net"]["ipv4"]["ip"])')
node() { ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -i ~/.ssh/nvoi_ed25519 root@$IP "$@"; }
TOKEN=$(python3 -c 'import json,os;print(json.load(open(os.path.expanduser("~/.hz/state.json")))["token"])')
api() { curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "https://api-dev.nvoi.to$@"; }
open_preview() { curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -m 300 -L -H "Accept: text/html" \
  -c /tmp/jar -b /tmp/jar "$(./bin/hz preview "$1")"; }   # $1: <session>-dev-preview.nvoi.to
install() { ./bin/hz cluster install dev --zone nvoi.to --ssh-key ~/.ssh/nvoi_ed25519 "$@"; }
plane_up() { for i in $(seq 90); do [ "$(curl -s -o /dev/null -w "%{http_code}" https://api-dev.nvoi.to/approvals)" = 401 ] && return; sleep 2; done; return 1; }
```

- Long commands run in the background with a Monitor on their log; report each step as it lands.

## Stages

| # | Command | Passes when |
|---|---|---|
| 1 | `go build -C packages/cli -o ../../bin/hz ./cmd/hz`; `go test ./...` in `packages/{shared,infra,hetzner,cloudflare,controlplane,boxd}` | builds, tests pass |
| 2 | `install` | ends with `api at https://api-dev.nvoi.to` |
| 3 | `./bin/hz credentials && ./bin/hz env apply examples/dummy-rails.yml` | no output, exit 0 |
| 4 | `./bin/hz seed dummy` | `seed ready:` link in about 2 min |
| 5 | Gate: `curl -s -o /dev/null -w "%{http_code}" https://dummy-dev-preview.nvoi.to/`, then `open_preview dummy-dev-preview.nvoi.to`, then `curl -H "x-hz-token: <token of another host>"` | 401; 200 through the 302; 401 |
| 6 | Fork: `api /sessions -d '{"env":"dummy","prompt":"Reply ok."}'`, poll `api /sessions/<id>` until `state` is not `forking` | `running` in under 10 s |
| 7 | `./bin/hz session start dummy "<task that ends in a pull request>"` | calls `mcp__hz__set_title`, commits, stops at `awaiting_approval` |
| 8 | Preview of the session while it runs | the agent's change is live with no restart |
| 9 | `./bin/hz approval list`, **ask the user**, then on their yes `./bin/hz approval approve <id>` (`deny` otherwise) | PR URL printed, session back to `idle` |
| 10 | Idle cycle, below | pause, hold, shrink, suspend, release, resume |
| 11 | Web UI in Chrome: `./bin/hz open`, then start a conversation from the home composer, watch it stream, queue a message while it works, withdraw one, open the preview panel, answer the gate, Stop a running turn | signed in on `app-dev.nvoi.to`; every step shows live without a reload; the reconnecting strip appears only while the stream is down |

Redeploy one step: `install --only "control plane" && plane_up`. `plane_up` gives up after 3 minutes; then read `node 'k3s kubectl -n hz-system logs deploy/plane --tail=30'`.

## Idle cycle with short thresholds

After deploying the scaler change (`install --only "control plane" && plane_up`):

```sh
node 'k3s kubectl -n hz-system set env deploy/plane HZ_PAUSE_AFTER=1m HZ_SUSPEND_AFTER=3m' && plane_up
open_preview <session>-dev-preview.nvoi.to          # the activity the timers count from
node 'k3s kubectl -n hz get workerpools; \
  k3s kubectl get nodes -o custom-columns=NODE:.metadata.name,HELD:".metadata.annotations.cluster-autoscaler\.kubernetes\.io/scale-down-disabled"; \
  k3s kubectl -n hz-system logs deploy/plane --since=35s | grep -E "pause|suspend|shrink|grow"'   # every 30 s, in a Monitor
```

Expected, in order: `pause <actor> on <node>` with the node held; `shrink hz-<tier>` to 0; `suspend <actor>` with the hold lifted; opening the preview again grows the pool and answers 200 (about 6 s from paused, 13 s from suspended).

Always restore the defaults afterwards:

```sh
node 'k3s kubectl -n hz-system set env deploy/plane HZ_PAUSE_AFTER- HZ_SUSPEND_AFTER-' && plane_up
```

## Common mistakes

| Symptom | Cause |
|---|---|
| 502 or `unauthorized` right after a redeploy | the plane is restarting; wait for the 401 probe |
| a fork waits for ever | the tier's pool is full and the node cannot grow; Hetzner's dedicated-core limit (8 on a new project) |
| 401 from Cloudflare on `*-preview` hosts | a zone Worker route catches the suffix; the install claims `*<suffix>.<zone>/*` with no Worker |
| seed rerun repeats an old failure | boxd run ids are idempotent; every attempt needs its own id |
| sessions from before a template change cannot resume | their pool or template is gone; reseed, start new sessions |

## Cleanup

Only when the user asks, or the cluster is no longer needed: it costs about €0.10 an hour while up. `./bin/hz cluster destroy dev --zone nvoi.to` removes servers, network, firewall, key, tunnel, records and the route claim. Approving in stage 9 opens a real pull request: never without the user's yes.
