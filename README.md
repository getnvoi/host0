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
packages/shared      names and the API contract
packages/infra       the install: interfaces (Cloud, Edge, Shell), steps, manifests, the node script
packages/hetzner     infra.Cloud
packages/cloudflare  infra.Edge
packages/cli         the hz binary
```
