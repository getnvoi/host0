package controlplane

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/naming"
	"github.com/getnvoi/host0/shared/tiers"
)

// A worker server whose node has not joined in this long is deleted, whatever Workers.Idle says.
const joinWait = 10 * time.Minute

// Worker servers, asked of the cloud and the cluster each time. Only when each was first seen free is kept, in memory:
// a plane that restarts starts the idle clock again.
type fleet struct {
	mu sync.Mutex
	// One create at a time: two at once would pick the same lowest free index.
	making sync.Mutex
	free   map[string]time.Time
}

var fl = &fleet{free: map[string]time.Time{}}

// The shape install wrote: worker servers and tiers.
func (p *Plane) shape() (contract.Shape, error) {
	var s contract.Shape
	if err := p.Store.Get("cluster", "shape", &s); err != nil {
		if errors.Is(err, ErrNotFound) {
			return s, fmt.Errorf("the plane holds no cluster shape: hz cluster install writes it")
		}
		return s, fmt.Errorf("the cluster shape: %w", err)
	}
	return s, nil
}

// The shape, and the cloud in its location.
func (p *Plane) cloud() (contract.Shape, cloud.Cloud, error) {
	shape, err := p.shape()
	if err != nil {
		return shape, nil, err
	}
	cl, err := p.Cloud(shape.Workers.Location)
	if err != nil {
		return shape, nil, fmt.Errorf("the cloud in %q: %w", shape.Workers.Location, err)
	}
	return shape, cl, nil
}

func (p *Plane) tier(name string) (tiers.Tier, error) {
	s, err := p.shape()
	if err != nil {
		return tiers.Tier{}, err
	}
	return tiers.Pick(s.Tiers, name)
}

func (p *Plane) SetShape(s contract.Shape) error {
	if _, err := tiers.Pick(s.Tiers, ""); err != nil {
		return badRequest{err}
	}
	if s.Workers.Max < 0 || s.Workers.Idle < 0 {
		return badRequest{fmt.Errorf("workers.max and workers.idle cannot be negative")}
	}
	return p.Store.Put("cluster", "shape", s)
}

type reportKey struct{}

// ctx whose reports go to f as well as the log: the seed or session waiting on a worker shows each step.
func reporting(ctx context.Context, f func(string)) context.Context {
	return context.WithValue(ctx, reportKey{}, f)
}

func report(ctx context.Context, format string, a ...any) {
	line := fmt.Sprintf(format, a...)
	log.Printf("workers: %s", line)
	if f, ok := ctx.Value(reportKey{}).(func(string)); ok {
		f(line)
	}
}

// Makes a worker server when a pool's pod finds no node: none while one is joining, none past Workers.Max. Returns the
// worker being waited for, if any.
func (p *Plane) place(ctx context.Context) (string, error) {
	if p.Cloud == nil {
		return "", nil
	}
	n, err := p.Pools.Unplaced(ctx)
	if err != nil || n == 0 {
		return "", err
	}
	fl.making.Lock()
	defer fl.making.Unlock()
	shape, cl, err := p.cloud()
	if err != nil {
		return "", err
	}
	c := naming.Cluster{Name: p.Cluster}
	servers, err := cl.List(ctx, c)
	if err != nil {
		return "", fmt.Errorf("listing worker servers: %w", err)
	}
	nodes, err := p.nodes(ctx)
	if err != nil {
		return "", err
	}
	used := map[int]bool{}
	for _, s := range servers {
		i, ok := c.WorkerIndex(s.Name)
		if !ok {
			continue
		}
		used[i] = true
		if joining(nodes, s.Name) {
			return s.Name, nil
		}
	}
	if len(used) >= shape.Workers.Max {
		return "", fmt.Errorf("workers are at their max of %d and no node has room: raise workers.max, or end a session", shape.Workers.Max)
	}
	i := 1
	for used[i] {
		i++
	}
	name := c.Worker(i)
	report(ctx, "creating server %s (%s, %s)", name, shape.Workers.Type, shape.Workers.Location)
	if _, err := cl.Server(ctx, c, cloud.Spec{Name: name, Type: shape.Workers.Type, PrivateIP: naming.WorkerIP(i),
		Init: p.WorkerInit}); err != nil {
		return "", fmt.Errorf("creating server %s: %w", name, err)
	}
	return name, nil
}

// A node ready this recently may still have pods the scheduler has not tried again.
const settleNode = time.Minute

func joining(nodes map[string]contract.Node, name string) bool {
	n, ok := nodes[name]
	return !ok || !n.Ready || time.Since(n.Created) < settleNode
}

func (p *Plane) nodes(ctx context.Context) (map[string]contract.Node, error) {
	list, err := p.Pools.Nodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing nodes: %w", err)
	}
	out := map[string]contract.Node{}
	for _, n := range list {
		out[n.Name] = n
	}
	return out, nil
}

// Reports each node waited for that is now ready, and stops waiting for it.
func (p *Plane) joined(ctx context.Context, waiting map[string]bool) error {
	if len(waiting) == 0 {
		return nil
	}
	nodes, err := p.nodes(ctx)
	if err != nil {
		return err
	}
	for name := range waiting {
		if nodes[name].Ready {
			report(ctx, "node %s ready", name)
			delete(waiting, name)
		}
	}
	return nil
}

// Deletes each worker server that has held no actor for Workers.Idle, and each worker Node whose server is gone.
func (p *Plane) retire(ctx context.Context) error {
	if p.Cloud == nil {
		return nil
	}
	shape, cl, err := p.cloud()
	if err != nil {
		return err
	}
	c := naming.Cluster{Name: p.Cluster}
	servers, err := cl.List(ctx, c)
	if err != nil {
		return fmt.Errorf("listing worker servers: %w", err)
	}
	nodes, err := p.nodes(ctx)
	if err != nil {
		return err
	}
	paused, err := p.pausedOn(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	have := map[string]bool{}
	for _, s := range servers {
		if _, ok := c.WorkerIndex(s.Name); !ok {
			continue
		}
		have[s.Name] = true
		node, joined := nodes[s.Name]
		limit := max(shape.Workers.Idle, joinWait)
		if joined {
			n, err := p.Pools.Occupants(ctx, s.Name)
			if err != nil {
				return fmt.Errorf("pods on %s: %w", s.Name, err)
			}
			if n > 0 || paused[s.Name] || now.Sub(node.Created) < shape.Workers.Idle {
				fl.forget(s.Name)
				continue
			}
			limit = shape.Workers.Idle
		}
		if since := fl.since(s.Name, now); now.Sub(since) < limit {
			continue
		}
		if err := p.drop(ctx, cl, s.Name, joined, limit); err != nil {
			return err
		}
	}
	for _, n := range nodes {
		if _, ok := c.WorkerIndex(n.Name); ok && !have[n.Name] && !n.Ready {
			log.Printf("workers: node %s has no server: forgetting it", n.Name)
			if err := p.Pools.Forget(ctx, n.Name); err != nil {
				return fmt.Errorf("forgetting node %s: %w", n.Name, err)
			}
		}
	}
	fl.keep(have)
	return nil
}

// Cordoned first, so nothing lands while its server goes; a pod that landed before keeps it.
func (p *Plane) drop(ctx context.Context, cl cloud.Cloud, name string, joined bool, idle time.Duration) error {
	if joined {
		if err := p.Pools.Cordon(ctx, name, true); err != nil {
			return fmt.Errorf("cordoning %s: %w", name, err)
		}
		if n, err := p.Pools.Occupants(ctx, name); err != nil || n > 0 {
			if uerr := p.Pools.Cordon(ctx, name, false); uerr != nil {
				return fmt.Errorf("uncordoning %s: %w", name, uerr)
			}
			fl.forget(name)
			return err
		}
		log.Printf("workers: %s has held no actor for %s: deleting it", name, idle)
	} else {
		log.Printf("workers: %s has not joined in %s: deleting it", name, idle)
	}
	if err := cl.Delete(ctx, name); err != nil {
		return fmt.Errorf("deleting server %s: %w", name, err)
	}
	if joined {
		if err := p.Pools.Forget(ctx, name); err != nil {
			return fmt.Errorf("forgetting node %s: %w", name, err)
		}
	}
	fl.forget(name)
	log.Printf("workers: %s deleted", name)
	return nil
}

// The nodes holding a paused actor's snapshot, which lives there only.
func (p *Plane) pausedOn(ctx context.Context) (map[string]bool, error) {
	out := map[string]bool{}
	for actor := range p.actors() {
		state, err := p.Sandboxes.State(ctx, actor)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("state of %s: %w", actor, err)
		}
		if state != "paused" {
			continue
		}
		node, err := p.Sandboxes.Node(ctx, actor)
		if err != nil {
			return nil, fmt.Errorf("node of paused %s: %w", actor, err)
		}
		out[node] = true
	}
	return out, nil
}

func (f *fleet) since(name string, now time.Time) time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	t, ok := f.free[name]
	if !ok {
		f.free[name] = now
		return now
	}
	return t
}

func (f *fleet) forget(name string) {
	f.mu.Lock()
	delete(f.free, name)
	f.mu.Unlock()
}

func (f *fleet) keep(have map[string]bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for name := range f.free {
		if !have[name] {
			delete(f.free, name)
		}
	}
}
