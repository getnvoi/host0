package main

import (
	"context"
	"fmt"

	"github.com/getnvoi/host0/internal/workers"
)

// The cluster as it is now: nodes and pools from Kubernetes, workers from Substrate, the plane's hosts from the edge.
func (p *plane) Status(ctx context.Context) (workers.Cluster, error) {
	out := workers.Cluster{Name: p.Cluster, Zone: p.Zone, Pools: []workers.Pool{}, Workers: []workers.Worker{}, Edge: []workers.Host{}}
	shape, err := p.sc.Shape()
	if err != nil {
		return out, err
	}
	if out.Nodes, err = p.Pools.Nodes(ctx); err != nil {
		return out, fmt.Errorf("nodes: %w", err)
	}
	for _, t := range shape.Tiers {
		pool := workers.Pool{Name: t.Pool()}
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
		var actors []string
		for _, h := range w.Held {
			actors = append(actors, h.String())
		}
		out.Workers = append(out.Workers, workers.Worker{Pool: w.Pool, Pod: w.Pod, Assigned: w.Assigned(), Actors: actors})
	}
	for _, h := range []string{p.Host("api"), p.Host("app")} {
		host := workers.Host{Name: h}
		if err := p.Edge.Check(ctx, h); err != nil {
			host.Error = err.Error()
		}
		out.Edge = append(out.Edge, host)
	}
	return out, nil
}
