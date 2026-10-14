package workers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/naming"
	"github.com/getnvoi/host0/internal/store"
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
func (s *Scaler) Shape() (sandbox.Shape, error) {
	var shape sandbox.Shape
	if err := s.Store.Get("cluster", "shape", &shape); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return shape, fmt.Errorf("the plane holds no cluster shape: hz cluster install writes it")
		}
		return shape, fmt.Errorf("the cluster shape: %w", err)
	}
	return shape, nil
}

// The shape, and the cloud in its location.
func (s *Scaler) cloud() (sandbox.Shape, cloud.Cloud, error) {
	shape, err := s.Shape()
	if err != nil {
		return shape, nil, err
	}
	cl, err := s.Cloud(shape.Workers.Location)
	if err != nil {
		return shape, nil, fmt.Errorf("the cloud in %q: %w", shape.Workers.Location, err)
	}
	return shape, cl, nil
}

// The tier named name; the default one for "".
func (s *Scaler) Tier(name string) (sandbox.Tier, error) {
	shape, err := s.Shape()
	if err != nil {
		return sandbox.Tier{}, err
	}
	return sandbox.Pick(shape.Tiers, name)
}

func (s *Scaler) SetShape(shape sandbox.Shape) error {
	if _, err := sandbox.Pick(shape.Tiers, ""); err != nil {
		return Invalid{err}
	}
	if shape.Workers.Max < 0 || shape.Workers.Idle < 0 {
		return Invalid{fmt.Errorf("workers.max and workers.idle cannot be negative")}
	}
	return s.Store.Put("cluster", "shape", shape)
}

// A shape that cannot be taken as it is.
type Invalid struct{ error }

// Logs the line, and reports it to whoever waits on ctx: the seed or session waiting on a worker shows each step.
func report(ctx context.Context, format string, a ...any) {
	log.Printf("workers: "+format, a...)
	sandbox.Progress(ctx, format, a...)
}

// Makes a worker server when a pool's pod finds no node: none while one is joining, none past Workers.Max. Returns the
// worker being waited for, if any.
func (s *Scaler) place(ctx context.Context) (string, error) {
	if s.Cloud == nil {
		return "", nil
	}
	n, err := s.Pools.Unplaced(ctx)
	if err != nil || n == 0 {
		return "", err
	}
	fl.making.Lock()
	defer fl.making.Unlock()
	shape, cl, err := s.cloud()
	if err != nil {
		return "", err
	}
	c := naming.Cluster{Name: s.Cluster}
	servers, err := cl.List(ctx, c)
	if err != nil {
		return "", fmt.Errorf("listing worker servers: %w", err)
	}
	nodes, err := s.nodes(ctx)
	if err != nil {
		return "", err
	}
	used := map[int]bool{}
	for _, srv := range servers {
		i, ok := c.WorkerIndex(srv.Name)
		if !ok {
			continue
		}
		used[i] = true
		if joining(nodes, srv.Name) {
			return srv.Name, nil
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
		Init: s.WorkerInit}); err != nil {
		return "", fmt.Errorf("creating server %s: %w", name, err)
	}
	return name, nil
}

// A node ready this recently may still have pods the scheduler has not tried again.
const settleNode = time.Minute

func joining(nodes map[string]kube.Node, name string) bool {
	n, ok := nodes[name]
	return !ok || !n.Ready || time.Since(n.Created) < settleNode
}

func (s *Scaler) nodes(ctx context.Context) (map[string]kube.Node, error) {
	list, err := s.Pools.Nodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing nodes: %w", err)
	}
	out := map[string]kube.Node{}
	for _, n := range list {
		out[n.Name] = n
	}
	return out, nil
}

// Reports each node waited for that is now ready, and stops waiting for it.
func (s *Scaler) joined(ctx context.Context, waiting map[string]bool) error {
	if len(waiting) == 0 {
		return nil
	}
	nodes, err := s.nodes(ctx)
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
func (s *Scaler) retire(ctx context.Context) error {
	if s.Cloud == nil {
		return nil
	}
	shape, cl, err := s.cloud()
	if err != nil {
		return err
	}
	c := naming.Cluster{Name: s.Cluster}
	servers, err := cl.List(ctx, c)
	if err != nil {
		return fmt.Errorf("listing worker servers: %w", err)
	}
	nodes, err := s.nodes(ctx)
	if err != nil {
		return err
	}
	paused, err := s.pausedOn(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	have := map[string]bool{}
	for _, srv := range servers {
		if _, ok := c.WorkerIndex(srv.Name); !ok {
			continue
		}
		have[srv.Name] = true
		node, joined := nodes[srv.Name]
		limit := max(shape.Workers.Idle, joinWait)
		if joined {
			n, err := s.Pools.Occupants(ctx, srv.Name)
			if err != nil {
				return fmt.Errorf("pods on %s: %w", srv.Name, err)
			}
			if n > 0 || paused[srv.Name] || now.Sub(node.Created) < shape.Workers.Idle {
				fl.forget(srv.Name)
				continue
			}
			limit = shape.Workers.Idle
		}
		if since := fl.since(srv.Name, now); now.Sub(since) < limit {
			continue
		}
		if err := s.drop(ctx, cl, srv.Name, joined, limit); err != nil {
			return err
		}
	}
	for _, n := range nodes {
		if _, ok := c.WorkerIndex(n.Name); ok && !have[n.Name] && !n.Ready {
			log.Printf("workers: node %s has no server: forgetting it", n.Name)
			if err := s.Pools.Forget(ctx, n.Name); err != nil {
				return fmt.Errorf("forgetting node %s: %w", n.Name, err)
			}
		}
	}
	fl.keep(have)
	return nil
}

// Cordoned first, so nothing lands while its server goes; a pod that landed before keeps it.
func (s *Scaler) drop(ctx context.Context, cl cloud.Cloud, name string, joined bool, idle time.Duration) error {
	if joined {
		if err := s.Pools.Cordon(ctx, name, true); err != nil {
			return fmt.Errorf("cordoning %s: %w", name, err)
		}
		if n, err := s.Pools.Occupants(ctx, name); err != nil || n > 0 {
			if uerr := s.Pools.Cordon(ctx, name, false); uerr != nil {
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
		if err := s.Pools.Forget(ctx, name); err != nil {
			return fmt.Errorf("forgetting node %s: %w", name, err)
		}
	}
	fl.forget(name)
	log.Printf("workers: %s deleted", name)
	return nil
}

// The nodes holding a paused actor's snapshot, which lives there only.
func (s *Scaler) pausedOn(ctx context.Context) (map[string]bool, error) {
	out := map[string]bool{}
	for actor := range s.actors() {
		state, err := s.Sandboxes.State(ctx, actor)
		if errors.Is(err, sandbox.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("state of %s: %w", actor, err)
		}
		if state != "paused" {
			continue
		}
		node, err := s.Sandboxes.Node(ctx, actor)
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
