package controlplane

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/getnvoi/nvoi/shared/tiers"
)

// Pools start at zero: the plane grows one when an actor finds no worker, and shrinks it to what holds an actor.
type Pools interface {
	Replicas(ctx context.Context, pool string) (int, error)
	// Workers of the pool that are up; fewer than its replicas means one is on its way.
	Ready(ctx context.Context, pool string) (int, error)
	Scale(ctx context.Context, pool string, replicas int) error
	Cost(ctx context.Context, pod string, cost int) error
	// Keeps the node from the cluster autoscaler while it holds a paused actor's snapshot.
	Hold(ctx context.Context, node string, on bool) error
}

type Worker struct {
	Pool, Pod string
	Assigned  bool
}

const (
	growEvery = 30 * time.Second
	// A worker still not up after this long no longer holds back the next.
	growWait   = 5 * time.Minute
	shrinkTick = 30 * time.Second
	// A worker free for this many ticks in a row goes; one freed a moment ago may be about to be taken.
	freeTicks = 2
	// No shrink this soon after a pool grew: its new worker is on its way to an actor.
	settle = 2 * time.Minute
)

type scaler struct {
	mu    sync.Mutex
	grown map[string]time.Time
	free  map[string]int
	// Pods given the lowest deletion cost for a shrink; the next shrink clears the mark on any still here.
	marked map[string]bool
	// Per actor: last activity, and what is in progress now (turns, open requests).
	seen map[string]time.Time
	open map[string]int
	// Per actor: held while it is woken or put to rest, so neither decides on a state the other is changing.
	guards map[string]*sync.Mutex
}

var sc = newScaler()

func newScaler() *scaler {
	return &scaler{grown: map[string]time.Time{}, free: map[string]int{}, marked: map[string]bool{}, seen: map[string]time.Time{}, open: map[string]int{},
		guards: map[string]*sync.Mutex{}}
}

func guard(actor string) *sync.Mutex {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	g, ok := sc.guards[actor]
	if !ok {
		g = &sync.Mutex{}
		sc.guards[actor] = g
	}
	return g
}

// Running, and counted as busy until release is called. Rest cannot pause it between the two.
func (p *Plane) enter(ctx context.Context, actor, tier string) (release func(), err error) {
	g := guard(actor)
	g.Lock()
	defer g.Unlock()
	if err := p.resume(ctx, actor, tier); err != nil {
		return nil, err
	}
	p.busy(actor, true)
	var once sync.Once
	return func() { once.Do(func() { p.busy(actor, false) }) }, nil
}

func (p *Plane) opened(actor string) bool {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.open[actor] > 0
}

func (p *Plane) touch(actor string) {
	sc.mu.Lock()
	sc.seen[actor] = time.Now()
	sc.mu.Unlock()
}

func (p *Plane) busy(actor string, on bool) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	sc.seen[actor] = time.Now()
	if on {
		sc.open[actor]++
	} else if sc.open[actor]--; sc.open[actor] <= 0 {
		delete(sc.open, actor)
	}
}

// How long the actor has been idle; zero while anything is in progress. An actor never seen since the plane
// started counts from now.
func idle(actor string) time.Duration {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if sc.open[actor] > 0 {
		return 0
	}
	last, ok := sc.seen[actor]
	if !ok {
		sc.seen[actor] = time.Now()
		return 0
	}
	return time.Since(last)
}

// One more worker for the pool, at most once per growEvery, and not while the last one is still on its way.
func (p *Plane) grow(ctx context.Context, pool string) {
	sc.mu.Lock()
	since := time.Since(sc.grown[pool])
	if since < growEvery {
		sc.mu.Unlock()
		return
	}
	sc.mu.Unlock()
	n, err := p.Pools.Replicas(ctx, pool)
	if err == nil && since < growWait {
		var up int
		if up, err = p.Pools.Ready(ctx, pool); err == nil && up < n {
			return
		}
	}
	sc.mu.Lock()
	sc.grown[pool] = time.Now()
	sc.mu.Unlock()
	if err == nil {
		err = p.Pools.Scale(ctx, pool, n+1)
	}
	if err != nil {
		log.Printf("grow %s: %v", pool, err)
		return
	}
	log.Printf("grow %s to %d", pool, n+1)
}

// Of the pods, those still free in the pool now, and how many of the pool's pods hold an actor.
func (p *Plane) free(ctx context.Context, pool string, pods []string) ([]string, int, error) {
	workers, err := p.Sandboxes.Workers(ctx)
	if err != nil {
		return nil, 0, err
	}
	want := map[string]bool{}
	for _, pod := range pods {
		want[pod] = true
	}
	var free []string
	busy := 0
	for _, w := range workers {
		if w.Pool != pool {
			continue
		}
		if w.Assigned {
			busy++
		} else if want[w.Pod] {
			free = append(free, w.Pod)
		}
	}
	return free, busy, nil
}

// Resumes an actor. With no free worker, a paused actor of the same tier gives up its own; failing that, the pool grows.
func (p *Plane) wake(ctx context.Context, actor string, tier tiers.Tier) error {
	for deadline := time.Now().Add(10 * time.Minute); ; {
		err := p.Sandboxes.Resume(ctx, actor)
		if err != ErrNoWorker || time.Now().After(deadline) {
			return err
		}
		if !p.evict(ctx, tier.Name, actor) {
			p.grow(ctx, tier.Pool())
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}

func (p *Plane) Scale(ctx context.Context) {
	for range time.Tick(shrinkTick) {
		if err := p.rest(ctx); err != nil {
			log.Printf("scaler: %v", err)
		}
		if err := p.shrink(ctx); err != nil {
			log.Printf("scaler: %v", err)
		}
	}
}

// Every actor the plane routes to, with its tier.
func (p *Plane) actors() map[string]string {
	out := map[string]string{}
	p.Store.List("routes", func(d func(any) error) error {
		var rt Route
		if d(&rt) == nil {
			out[rt.Actor] = rt.Tier
		}
		return nil
	})
	return out
}

// Pauses actors idle PauseAfter, suspends those idle SuspendAfter. An actor being woken is skipped.
func (p *Plane) rest(ctx context.Context) error {
	for actor := range p.actors() {
		g := guard(actor)
		if !g.TryLock() {
			continue
		}
		p.lull(ctx, actor)
		g.Unlock()
	}
	p.hold(ctx)
	return nil
}

// Rests one actor; its guard is held, so the idle check stands until the pause is done.
func (p *Plane) lull(ctx context.Context, actor string) {
	quiet := idle(actor)
	if quiet < p.PauseAfter {
		return
	}
	state, err := p.Sandboxes.State(ctx, actor)
	if err != nil {
		return
	}
	switch {
	case state == "running" && quiet >= p.SuspendAfter, state == "paused" && quiet >= p.SuspendAfter:
		log.Printf("suspend %s, idle %s", actor, quiet.Round(time.Second))
		err = p.Sandboxes.Suspend(ctx, actor)
	case state == "running":
		var node string
		if node, err = p.Sandboxes.Node(ctx, actor); err != nil {
			break
		}
		// Held before the pause: from then on the node carries the only copy of what changed since the last suspend.
		if err = p.Store.Put("paused", actor, node); err != nil {
			break
		}
		p.hold(ctx)
		if idle(actor) < p.PauseAfter {
			return
		}
		log.Printf("pause %s on %s, idle %s", actor, node, quiet.Round(time.Second))
		err = p.Sandboxes.Pause(ctx, actor)
	}
	if err != nil {
		log.Printf("rest %s: %v", actor, err)
	}
}

// Holds every node that carries a paused actor's snapshot and releases the rest it held.
func (p *Plane) hold(ctx context.Context) {
	want := map[string]bool{}
	var done []string
	p.Store.List("paused", func(d func(any) error) error {
		var node string
		d(&node)
		want[node] = true
		return nil
	})
	for actor := range p.actors() {
		var node string
		if p.Store.Get("paused", actor, &node) != nil {
			continue
		}
		// Released once the snapshot is uploaded or gone; a running actor keeps its node busy anyway.
		switch state, err := p.Sandboxes.State(ctx, actor); {
		case errors.Is(err, ErrNotFound):
			done = append(done, actor)
		case err != nil:
		case state == "suspended", state == "crashed", state == "deleting":
			done = append(done, actor)
		}
	}
	for _, actor := range done {
		p.Store.Delete("paused", actor)
	}
	if len(done) > 0 {
		want = map[string]bool{}
		p.Store.List("paused", func(d func(any) error) error {
			var node string
			d(&node)
			want[node] = true
			return nil
		})
	}
	var held []string
	p.Store.Get("held", "nodes", &held)
	for _, n := range held {
		if !want[n] {
			if err := p.Pools.Hold(ctx, n, false); err != nil {
				log.Printf("release %s: %v", n, err)
				want[n] = true
			}
		}
	}
	held = held[:0]
	for n := range want {
		if err := p.Pools.Hold(ctx, n, true); err != nil {
			log.Printf("hold %s: %v", n, err)
		}
		held = append(held, n)
	}
	p.Store.Put("held", "nodes", held)
}

// Suspends the tier's longest-idle paused actor, freeing its worker for another. False when there is none.
func (p *Plane) evict(ctx context.Context, tier, except string) bool {
	var victim string
	var longest time.Duration
	for actor, t := range p.actors() {
		if t != tier || actor == except || p.opened(actor) {
			continue
		}
		if state, err := p.Sandboxes.State(ctx, actor); err != nil || state != "paused" {
			continue
		}
		if q := idle(actor); q >= longest {
			victim, longest = actor, q
		}
	}
	if victim == "" {
		return false
	}
	// Someone waking it, or resting it, has it; it is not taken from under them.
	g := guard(victim)
	if !g.TryLock() {
		return false
	}
	defer g.Unlock()
	if p.opened(victim) {
		return false
	}
	log.Printf("suspend %s for %s", victim, except)
	if err := p.Sandboxes.Suspend(ctx, victim); err != nil {
		log.Printf("evict %s: %v", victim, err)
		return false
	}
	return true
}

// Decided on a snapshot taken under sc.mu, which is released for the calls to the cluster.
func (p *Plane) shrink(ctx context.Context) error {
	workers, err := p.Sandboxes.Workers(ctx)
	if err != nil {
		return err
	}
	// A pod marked last time and still here was taken before the pool dropped: it loses its mark.
	sc.mu.Lock()
	var kept []string
	for _, w := range workers {
		if sc.marked[w.Pod] {
			kept = append(kept, w.Pod)
		}
	}
	sc.marked = map[string]bool{}
	sc.mu.Unlock()
	for _, pod := range kept {
		if err := p.Pools.Cost(ctx, pod, 0); err != nil {
			log.Printf("shrink: unmark %s: %v", pod, err)
		}
	}
	byPool := map[string][]Worker{}
	for _, w := range workers {
		byPool[w.Pool] = append(byPool[w.Pool], w)
	}
	type plan struct {
		pool string
		busy int
		gone []string
	}
	var plans []plan
	sc.mu.Lock()
	for _, t := range tiers.All {
		pool := t.Pool()
		if time.Since(sc.grown[pool]) < settle {
			continue
		}
		pl := plan{pool: pool}
		for _, w := range byPool[pool] {
			if w.Assigned {
				pl.busy++
				delete(sc.free, w.Pod)
				continue
			}
			if sc.free[w.Pod]++; sc.free[w.Pod] >= freeTicks {
				pl.gone = append(pl.gone, w.Pod)
			}
		}
		if len(pl.gone) > 0 {
			plans = append(plans, pl)
		}
	}
	sc.mu.Unlock()
	for _, pl := range plans {
		// A grow since the snapshot means its worker is on the way: this shrink waits for the next tick.
		sc.mu.Lock()
		grown := time.Since(sc.grown[pl.pool]) < settle
		sc.mu.Unlock()
		if grown {
			continue
		}
		n, err := p.Pools.Replicas(ctx, pl.pool)
		if err != nil || n <= pl.busy {
			continue
		}
		// Only pods still free now go, and only as many as the pool drops: every pod marked is one the ReplicaSet
		// removes, so no mark is left on a pod an actor takes later.
		free, busy, err := p.free(ctx, pl.pool, pl.gone)
		if err != nil {
			return err
		}
		keep := max(busy, n-len(free))
		free = free[:n-keep]
		if len(free) == 0 {
			continue
		}
		for _, pod := range free {
			if err := p.Pools.Cost(ctx, pod, -1000); err != nil {
				return err
			}
		}
		sc.mu.Lock()
		for _, pod := range free {
			sc.marked[pod] = true
		}
		sc.mu.Unlock()
		if err := p.Pools.Scale(ctx, pl.pool, keep); err != nil {
			return err
		}
		sc.mu.Lock()
		for _, pod := range pl.gone {
			delete(sc.free, pod)
		}
		sc.mu.Unlock()
		log.Printf("shrink %s from %d to %d", pl.pool, n, keep)
	}
	return nil
}
