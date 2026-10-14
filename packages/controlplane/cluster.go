package controlplane

import (
	"context"
	"fmt"

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

// The cluster as it is now: nodes and pools from Kubernetes, workers from Substrate, the plane's hosts from the edge.
func (p *Plane) Status(ctx context.Context) (contract.Cluster, error) {
	out := contract.Cluster{Name: p.Cluster, Zone: p.Zone, Pools: []contract.Pool{}, Workers: []contract.Worker{}, Edge: []contract.Host{}}
	var err error
	if out.Nodes, err = p.Pools.Nodes(ctx); err != nil {
		return out, fmt.Errorf("nodes: %w", err)
	}
	for _, t := range tiers.All {
		pool := contract.Pool{Name: t.Pool()}
		if pool.Replicas, err = p.Pools.Replicas(ctx, pool.Name); err != nil {
			return out, fmt.Errorf("pool %s: %w", pool.Name, err)
		}
		if pool.Ready, err = p.Pools.Ready(ctx, pool.Name); err != nil {
			return out, fmt.Errorf("pool %s: %w", pool.Name, err)
		}
		out.Pools = append(out.Pools, pool)
	}
	ws, err := p.Sandboxes.Workers(ctx)
	if err != nil {
		return out, fmt.Errorf("workers: %w", err)
	}
	for _, w := range ws {
		out.Workers = append(out.Workers, contract.Worker{Pool: w.Pool, Pod: w.Pod, Assigned: w.Assigned})
	}
	for _, h := range []string{p.Host("api"), p.Host("app")} {
		host := contract.Host{Name: h}
		if err := p.Edge.Check(ctx, h); err != nil {
			host.Error = err.Error()
		}
		out.Edge = append(out.Edge, host)
	}
	return out, nil
}
