package controlplane

import (
	"context"
	"encoding/json"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/getnvoi/nvoi/shared/tiers"
)

type fakeSandboxes struct {
	Sandboxes
	workers []Worker
	full    int // resumes answering ErrNoWorker before one succeeds
	states  map[string]string
}

func (f *fakeSandboxes) State(_ context.Context, a string) (string, error) { return f.states[a], nil }
func (f *fakeSandboxes) Pause(_ context.Context, a string) error           { f.states[a] = "paused"; return nil }
func (f *fakeSandboxes) Node(context.Context, string) (string, error)      { return "n1", nil }
func (f *fakeSandboxes) Suspend(_ context.Context, a string) error {
	f.states[a] = "suspended"
	f.full = 0
	return nil
}

// Records are kept as JSON, as the real store keeps them: what is read back is a copy, never the writer's value.
type fakeStore struct {
	mu     sync.Mutex
	routes []Route
	kv     map[string]map[string][]byte
}

func newStore(routes ...Route) *fakeStore {
	return &fakeStore{routes: routes, kv: map[string]map[string][]byte{}}
}

func (f *fakeStore) Get(kind, id string, v any) error {
	f.mu.Lock()
	b, ok := f.kv[kind][id]
	f.mu.Unlock()
	if !ok {
		return ErrNotFound
	}
	return json.Unmarshal(b, v)
}
func (f *fakeStore) Put(kind, id string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.kv[kind] == nil {
		f.kv[kind] = map[string][]byte{}
	}
	f.kv[kind][id] = b
	return nil
}
func (f *fakeStore) Delete(kind, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.kv[kind], id)
	return nil
}
func (f *fakeStore) List(kind string, each func(func(any) error) error) error {
	if kind == "routes" {
		for _, r := range f.routes {
			r := r
			each(func(v any) error { *(v.(*Route)) = r; return nil })
		}
		return nil
	}
	f.mu.Lock()
	var all [][]byte
	for _, b := range f.kv[kind] {
		all = append(all, b)
	}
	f.mu.Unlock()
	for _, b := range all {
		each(func(v any) error { return json.Unmarshal(b, v) })
	}
	return nil
}

func (f *fakeSandboxes) Workers(context.Context) ([]Worker, error) { return f.workers, nil }
func (f *fakeSandboxes) Resume(context.Context, string) error {
	if f.full > 0 {
		f.full--
		return ErrNoWorker
	}
	return nil
}
func (f *fakeSandboxes) Dial(context.Context, string, int) (net.Conn, error) { return nil, nil }

type fakePools struct {
	replicas map[string]int
	ready    map[string]int
	costs    map[string]int
	held     map[string]bool
}

func (f *fakePools) Replicas(_ context.Context, pool string) (int, error) {
	return f.replicas[pool], nil
}
func (f *fakePools) Ready(_ context.Context, pool string) (int, error) {
	if f.ready == nil {
		return f.replicas[pool], nil
	}
	return f.ready[pool], nil
}
func (f *fakePools) Scale(_ context.Context, pool string, n int) error {
	f.replicas[pool] = n
	return nil
}
func (f *fakePools) Cost(_ context.Context, pod string, c int) error { f.costs[pod] = c; return nil }
func (f *fakePools) Hold(_ context.Context, node string, on bool) error {
	if f.held == nil {
		f.held = map[string]bool{}
	}
	f.held[node] = on
	return nil
}

func TestShrink(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{workers: []Worker{
		{Pool: "nvoi-medium", Pod: "busy", Assigned: true},
		{Pool: "nvoi-medium", Pod: "idle"},
	}}
	pools := &fakePools{replicas: map[string]int{"nvoi-medium": 2}, costs: map[string]int{}}
	p := &Plane{Sandboxes: sb, Pools: pools}
	ctx := context.Background()

	p.shrink(ctx)
	if pools.replicas["nvoi-medium"] != 2 {
		t.Fatal("shrank on the first tick a worker was free")
	}
	p.shrink(ctx)
	if pools.replicas["nvoi-medium"] != 1 || pools.costs["idle"] != -1000 {
		t.Fatalf("second tick: replicas %d costs %v", pools.replicas["nvoi-medium"], pools.costs)
	}
	if _, touched := pools.costs["busy"]; touched {
		t.Fatal("a busy worker was costed")
	}

	sc.grown["nvoi-medium"] = time.Now()
	pools.replicas["nvoi-medium"] = 2
	p.shrink(ctx)
	p.shrink(ctx)
	if pools.replicas["nvoi-medium"] != 2 {
		t.Fatal("shrank right after a grow")
	}
}

func TestWakeGrows(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{full: 1}
	pools := &fakePools{replicas: map[string]int{"nvoi-large": 0}, costs: map[string]int{}}
	p := &Plane{Sandboxes: sb, Pools: pools, Store: newStore()}
	large, _ := tiers.Get("large")
	if err := p.wake(context.Background(), "a", large); err != nil {
		t.Fatal(err)
	}
	if pools.replicas["nvoi-large"] != 1 {
		t.Fatalf("large not grown from zero: %d", pools.replicas["nvoi-large"])
	}
}

func TestRest(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{states: map[string]string{"a": "running", "b": "running", "c": "paused"}}
	p := &Plane{Sandboxes: sb, Store: newStore(Route{"a", 3000, "medium"}, Route{"b", 3000, "medium"}, Route{"c", 3000, "medium"}), Pools: &fakePools{},
		PauseAfter: 10 * time.Minute, SuspendAfter: time.Hour}
	now := time.Now()
	sc.seen["a"] = now.Add(-11 * time.Minute)
	sc.seen["b"] = now.Add(-11 * time.Minute)
	sc.open["b"] = 1
	sc.seen["c"] = now.Add(-61 * time.Minute)
	p.rest(context.Background())
	if sb.states["a"] != "paused" || sb.states["b"] != "running" || sb.states["c"] != "suspended" {
		t.Fatalf("states %v", sb.states)
	}
	if held := p.Pools.(*fakePools).held; !held["n1"] {
		t.Fatalf("the paused actor's node is not held: %v", held)
	}
	sb.states["a"] = "suspended"
	p.hold(context.Background())
	if held := p.Pools.(*fakePools).held; held["n1"] {
		t.Fatal("the node is still held with nothing paused on it")
	}
}

func TestWakeEvictsBeforeGrowing(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{full: 1, states: map[string]string{"old": "paused", "new": "suspended"}}
	pools := &fakePools{replicas: map[string]int{"nvoi-medium": 1}, costs: map[string]int{}}
	p := &Plane{Sandboxes: sb, Pools: pools, Store: newStore(Route{"old", 3000, "medium"}, Route{"new", 3000, "medium"})}
	medium, _ := tiers.Get("medium")
	if err := p.wake(context.Background(), "new", medium); err != nil {
		t.Fatal(err)
	}
	if sb.states["old"] != "suspended" || pools.replicas["nvoi-medium"] != 1 {
		t.Fatalf("expected the paused actor evicted and no growth: %v %v", sb.states, pools.replicas)
	}
}

func TestEvictSkipsBusy(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{full: 1, states: map[string]string{"old": "paused", "new": "suspended"}}
	pools := &fakePools{replicas: map[string]int{"nvoi-medium": 1}, costs: map[string]int{}}
	p := &Plane{Sandboxes: sb, Pools: pools, Store: newStore(Route{"old", 3000, "medium"}, Route{"new", 3000, "medium"})}
	sc.open["old"] = 1
	medium, _ := tiers.Get("medium")
	if err := p.wake(context.Background(), "new", medium); err != nil {
		t.Fatal(err)
	}
	if sb.states["old"] != "paused" || pools.replicas["nvoi-medium"] != 2 {
		t.Fatalf("a busy actor was evicted: %v %v", sb.states, pools.replicas)
	}
}

type goneSandboxes struct{ *fakeSandboxes }

func (g goneSandboxes) State(ctx context.Context, a string) (string, error) {
	if a == "gone" {
		return "", ErrNotFound
	}
	return g.fakeSandboxes.State(ctx, a)
}

func TestHoldForgetsDeletedActors(t *testing.T) {
	sc = newScaler()
	pools := &fakePools{}
	p := &Plane{Sandboxes: goneSandboxes{&fakeSandboxes{}}, Pools: pools, Store: newStore(Route{"gone", 3000, "medium"})}
	p.Store.Put("paused", "gone", "n1")
	p.Store.Put("held", "nodes", []string{"n1"})
	p.hold(context.Background())
	if p.Store.Get("paused", "gone", new(string)) == nil || pools.held["n1"] {
		t.Fatalf("the node of a deleted actor is still held: %v", pools.held)
	}
}

func TestGrowWaitsForStartingWorker(t *testing.T) {
	sc = newScaler()
	pools := &fakePools{replicas: map[string]int{"nvoi-medium": 1}, ready: map[string]int{"nvoi-medium": 0}}
	p := &Plane{Pools: pools}
	sc.grown["nvoi-medium"] = time.Now().Add(-time.Minute)
	p.grow(context.Background(), "nvoi-medium")
	if pools.replicas["nvoi-medium"] != 1 {
		t.Fatalf("grew to %d while a worker was starting", pools.replicas["nvoi-medium"])
	}
	sc.grown["nvoi-medium"] = time.Now().Add(-growWait)
	p.grow(context.Background(), "nvoi-medium")
	if pools.replicas["nvoi-medium"] != 2 {
		t.Fatalf("did not grow past a stuck worker: %d", pools.replicas["nvoi-medium"])
	}
	pools.ready["nvoi-medium"] = 2
	sc.grown["nvoi-medium"] = time.Now().Add(-time.Minute)
	p.grow(context.Background(), "nvoi-medium")
	if pools.replicas["nvoi-medium"] != 3 {
		t.Fatalf("did not grow a ready pool: %d", pools.replicas["nvoi-medium"])
	}
}

// A pod marked for a shrink and taken before it went loses its mark, so the ReplicaSet does not pick it later.
func TestShrinkUnmarksTaken(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{workers: []Worker{{Pool: "nvoi-medium", Pod: "a"}, {Pool: "nvoi-medium", Pod: "b"}}}
	pools := &fakePools{replicas: map[string]int{"nvoi-medium": 2}, costs: map[string]int{}}
	p := &Plane{Sandboxes: sb, Pools: pools}
	ctx := context.Background()
	p.shrink(ctx)
	p.shrink(ctx)
	if pools.replicas["nvoi-medium"] != 0 || pools.costs["a"] != -1000 || pools.costs["b"] != -1000 {
		t.Fatalf("replicas %d costs %v", pools.replicas["nvoi-medium"], pools.costs)
	}
	// "b" was resumed onto before the ReplicaSet removed it.
	sb.workers = []Worker{{Pool: "nvoi-medium", Pod: "b", Assigned: true}}
	pools.replicas["nvoi-medium"] = 1
	p.shrink(ctx)
	if pools.costs["b"] != 0 {
		t.Fatalf("a taken pod kept its mark: %v", pools.costs)
	}
}
