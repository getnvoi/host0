# hz

Coding agents on a cluster you own. Each task forks a running copy of your app, gets its own preview URL,
and asks before it acts outside its sandbox.

## Requirements

- A Hetzner Cloud project and its token, dedicated to hz.
- A Cloudflare zone and a token scoped to it: Zone DNS Edit, Account Cloudflare Tunnel Edit.
- On the machine that installs: `go`, `ko`, `git`, and an SSH key.

## Install

```sh
export HCLOUD_TOKEN=… CLOUDFLARE_API_TOKEN=…
hz cluster install dev --zone example.com
```

One control node (ccx23) running k3s, Agent Substrate, a registry, the Hetzner cloud controller, the
cluster-autoscaler and a Cloudflare tunnel. Workers (ccx33) come and go with the load; at rest there are none.
Nothing listens publicly but SSH.

```sh
hz cluster destroy dev --zone example.com
```

## Layout

```
apps/plane       the api, sandboxes, turns, approvals; serves the web UI
apps/boxd        commands and their durable output in each actor
apps/proxy       TLS for the public edge
apps/hz          the hz binary
apps/ui          the web UI, embedded in the plane
packages/shared  names and the API contract
packages/cloud   the Cloud contract: hetzner, scaleway
packages/edge    the Edge contract: cloudflare, dns
packages/infra   the install: Shell, steps, manifests, the node script
```
