package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/workers"
)

type PodLog struct {
	Log string `json:"log" doc:"The last lines of the container's log"`
}

var errNoPods = errors.New("this plane reads no pods")

var errNoDB = errors.New("this plane names no database file")

// The cluster now, the shape install wrote, and any pod with its log.
func (p *plane) cluster(a huma.API) {
	huma.Register(a, op("ls", "GET", "/cluster", "The cluster now: its nodes, worker pools, workers and the plane's hosts",
		h0{By: []string{"ls"}}),
		func(ctx context.Context, _ *struct{}) (*body[workers.Cluster], error) {
			return answer(p.Status(ctx))
		})
	huma.Register(a, op("cluster.shape", "GET", "/cluster/shape", "The workers and tiers h0 cluster install declared",
		h0{Output: "fields"}),
		func(context.Context, *struct{}) (*body[sandbox.Shape], error) {
			return answer(p.sc.Shape())
		})
	huma.Register(a, bearerOnly(op("cluster.shape.put", "PUT", "/cluster/shape", "Declare the workers and tiers",
		h0{By: []string{"cluster install"}})),
		func(_ context.Context, in *struct{ Body sandbox.Shape }) (*struct{}, error) {
			return nil, problem(p.sc.SetShape(in.Body))
		})
	huma.Register(a, op("cluster.db", "GET", "/cluster/db", "The plane's database as it lies on disk: no plaintext, no foreign file, every secret sealed",
		h0{Output: "fields", Columns: []string{"ok", "dir", "markers", "found", "plain", "foreign", "sealed", "unsealed", "files"}, NoTool: true}),
		func(context.Context, *struct{}) (*body[db.AtRest], error) {
			if p.DBPath == "" {
				return nil, problem(errNoDB)
			}
			return answer(db.Inspect(p.DB, p.DBPath))
		})
	huma.Register(a, op("pods", "GET", "/cluster/pods", "Every pod in the cluster, or one node's",
		h0{Output: "table", Columns: []string{"namespace", "name", "node", "phase"}}),
		func(ctx context.Context, in *struct {
			Node string `query:"node" doc:"Only this node's pods"`
		}) (*body[[]kube.Pod], error) {
			if p.Pods == nil {
				return nil, problem(errNoPods)
			}
			return answer(p.Pods.List(ctx, in.Node))
		})
	huma.Register(a, op("logs", "GET", "/cluster/pods/{namespace}/{pod}/log", "The end of a cluster pod's log",
		h0{Output: "raw", Field: "log"}),
		func(ctx context.Context, in *struct {
			Namespace string `path:"namespace" doc:"The pod's namespace, as h0 pods prints it"`
			Pod       string `path:"pod" doc:"The pod's name"`
			Container string `query:"container" doc:"The container, when the pod has several"`
			Tail      int    `query:"tail" default:"200" minimum:"1" doc:"Lines from the end"`
		}) (*body[PodLog], error) {
			if p.Pods == nil {
				return nil, problem(errNoPods)
			}
			log, err := p.Pods.Log(ctx, in.Namespace, in.Pod, in.Container, in.Tail)
			return answer(PodLog{log}, err)
		})
}

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
