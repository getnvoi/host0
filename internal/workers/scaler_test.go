package workers

import (
	"context"
	"net"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/seal"
)

type fakeSandboxes struct {
	sandbox.Sandboxes
	workers []sandbox.Worker
	full    int // resumes answering ErrNoWorker before one succeeds
	states  map[string]string
	deleted []string
}

func (f *fakeSandboxes) Delete(_ context.Context, a string) error {
	f.deleted = append(f.deleted, a)
	return nil
}

func (f *fakeSandboxes) State(_ context.Context, a string) (string, error) { return f.states[a], nil }
func (f *fakeSandboxes) Pause(_ context.Context, a string) error           { f.states[a] = "paused"; return nil }
func (f *fakeSandboxes) Node(context.Context, string) (string, error)      { return "n1", nil }
func (f *fakeSandboxes) Suspend(_ context.Context, a string) error {
	f.states[a] = "suspended"
	f.full = 0
	return nil
}

// A database in a fresh file, migrated, holding no shape.
func emptyDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := db.Open(filepath.Join(t.TempDir(), "h0.db"), seal.Mint())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if s, err := gdb.DB(); err == nil {
			s.Close()
		}
	})
	if err := db.Migrate(gdb); err != nil {
		t.Fatal(err)
	}
	return gdb
}

// With the shape install writes (the default tiers, two workers idle for a minute at most) and routes, each from a
// host named after its actor.
func newDB(t *testing.T, routes ...sandbox.Route) *gorm.DB {
	t.Helper()
	gdb := emptyDB(t)
	if err := (&Scaler{DB: gdb}).SetShape(testShape); err != nil {
		t.Fatal(err)
	}
	for _, rt := range routes {
		if err := gdb.Create(&db.Route{Host: rt.Actor + ".preview", Actor: rt.Actor, Port: rt.Port, Tier: rt.Tier}).Error; err != nil {
			t.Fatal(err)
		}
	}
	return gdb
}

var testShape = sandbox.Shape{Workers: sandbox.Servers{Type: "ccx23", Location: "fsn1", Max: 2, Idle: time.Minute}, Tiers: sandbox.DefaultTiers,
	Actors: sandbox.Rest{Pause: 10 * time.Minute, Suspend: time.Hour}}

func (f *fakeSandboxes) Workers(context.Context) ([]sandbox.Worker, error) { return f.workers, nil }
func (f *fakeSandboxes) Resume(context.Context, string) error {
	if f.full > 0 {
		f.full--
		return sandbox.ErrNoWorker
	}
	return nil
}
func (f *fakeSandboxes) Dial(context.Context, string, int) (net.Conn, error) { return nil, nil }

type fakePools struct {
	replicas  map[string]int
	ready     map[string]int
	costs     map[string]int
	nodes     []kube.Node
	unplaced  int
	occupants map[string]int
	cordoned  map[string]bool
	forgot    []string
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
func (f *fakePools) Nodes(context.Context) ([]kube.Node, error) {
	return append([]kube.Node{}, f.nodes...), nil
}
func (f *fakePools) Unplaced(context.Context) (int, error) { return f.unplaced, nil }
func (f *fakePools) Occupants(_ context.Context, node string) (int, error) {
	return f.occupants[node], nil
}
func (f *fakePools) Cordon(_ context.Context, node string, on bool) error {
	if f.cordoned == nil {
		f.cordoned = map[string]bool{}
	}
	f.cordoned[node] = on
	return nil
}
func (f *fakePools) Forget(_ context.Context, node string) error {
	f.forgot = append(f.forgot, node)
	f.nodes = slices.DeleteFunc(f.nodes, func(n kube.Node) bool { return n.Name == node })
	return nil
}
func (f *fakePools) Cost(_ context.Context, pod string, c int) error { f.costs[pod] = c; return nil }

func TestShrink(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{workers: []sandbox.Worker{
		{Pool: "h0-medium", Pod: "busy", Held: []sandbox.Held{{Name: "a", State: "running"}}},
		{Pool: "h0-medium", Pod: "idle"},
	}}
	pools := &fakePools{replicas: map[string]int{"h0-medium": 2}, costs: map[string]int{}}
	p := &Scaler{Sandboxes: sb, Pools: pools, DB: newDB(t)}
	ctx := context.Background()

	p.shrink(ctx)
	if pools.replicas["h0-medium"] != 2 {
		t.Fatal("shrank on the first tick a worker was free")
	}
	p.shrink(ctx)
	if pools.replicas["h0-medium"] != 1 || pools.costs["idle"] != -1000 {
		t.Fatalf("second tick: replicas %d costs %v", pools.replicas["h0-medium"], pools.costs)
	}
	if _, touched := pools.costs["busy"]; touched {
		t.Fatal("a busy worker was costed")
	}

	sc.grown["h0-medium"] = time.Now()
	pools.replicas["h0-medium"] = 2
	p.shrink(ctx)
	p.shrink(ctx)
	if pools.replicas["h0-medium"] != 2 {
		t.Fatal("shrank right after a grow")
	}
}

func TestWakeGrows(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{full: 1}
	pools := &fakePools{replicas: map[string]int{"h0-large": 0}, costs: map[string]int{}}
	p := &Scaler{Sandboxes: sb, Pools: pools, DB: newDB(t)}
	large, _ := sandbox.Pick(sandbox.DefaultTiers, "large")
	if err := p.Wake(context.Background(), "a", large); err != nil {
		t.Fatal(err)
	}
	if pools.replicas["h0-large"] != 1 {
		t.Fatalf("large not grown from zero: %d", pools.replicas["h0-large"])
	}
}

func TestRest(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{states: map[string]string{"a": "running", "b": "running", "c": "paused"}}
	p := &Scaler{Sandboxes: sb, DB: newDB(t, sandbox.Route{Actor: "a", Port: 3000, Tier: "medium"}, sandbox.Route{Actor: "b", Port: 3000, Tier: "medium"}, sandbox.Route{Actor: "c", Port: 3000, Tier: "medium"}), Pools: &fakePools{}}
	now := time.Now()
	sc.seen["a"] = now.Add(-11 * time.Minute)
	sc.seen["b"] = now.Add(-11 * time.Minute)
	sc.open["b"] = 1
	sc.seen["c"] = now.Add(-61 * time.Minute)
	p.rest(context.Background())
	if sb.states["a"] != "paused" || sb.states["b"] != "running" || sb.states["c"] != "suspended" {
		t.Fatalf("states %v", sb.states)
	}
}

func TestWakeEvictsBeforeGrowing(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{full: 1, states: map[string]string{"old": "paused", "new": "suspended"}}
	pools := &fakePools{replicas: map[string]int{"h0-medium": 1}, costs: map[string]int{}}
	p := &Scaler{Sandboxes: sb, Pools: pools, DB: newDB(t, sandbox.Route{Actor: "old", Port: 3000, Tier: "medium"}, sandbox.Route{Actor: "new", Port: 3000, Tier: "medium"})}
	medium, _ := sandbox.Pick(sandbox.DefaultTiers, "medium")
	if err := p.Wake(context.Background(), "new", medium); err != nil {
		t.Fatal(err)
	}
	if sb.states["old"] != "suspended" || pools.replicas["h0-medium"] != 1 {
		t.Fatalf("expected the paused actor evicted and no growth: %v %v", sb.states, pools.replicas)
	}
}

func TestEvictSkipsBusy(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{full: 1, states: map[string]string{"old": "paused", "new": "suspended"}}
	pools := &fakePools{replicas: map[string]int{"h0-medium": 1}, costs: map[string]int{}}
	p := &Scaler{Sandboxes: sb, Pools: pools, DB: newDB(t, sandbox.Route{Actor: "old", Port: 3000, Tier: "medium"}, sandbox.Route{Actor: "new", Port: 3000, Tier: "medium"})}
	sc.open["old"] = 1
	medium, _ := sandbox.Pick(sandbox.DefaultTiers, "medium")
	if err := p.Wake(context.Background(), "new", medium); err != nil {
		t.Fatal(err)
	}
	if sb.states["old"] != "paused" || pools.replicas["h0-medium"] != 2 {
		t.Fatalf("a busy actor was evicted: %v %v", sb.states, pools.replicas)
	}
}

func TestGrowWaitsForStartingWorker(t *testing.T) {
	sc = newScaler()
	pools := &fakePools{replicas: map[string]int{"h0-medium": 1}, ready: map[string]int{"h0-medium": 0}}
	p := &Scaler{Pools: pools}
	sc.grown["h0-medium"] = time.Now().Add(-time.Minute)
	p.grow(context.Background(), "h0-medium")
	if pools.replicas["h0-medium"] != 1 {
		t.Fatalf("grew to %d while a worker was starting", pools.replicas["h0-medium"])
	}
	sc.grown["h0-medium"] = time.Now().Add(-growWait)
	p.grow(context.Background(), "h0-medium")
	if pools.replicas["h0-medium"] != 2 {
		t.Fatalf("did not grow past a stuck worker: %d", pools.replicas["h0-medium"])
	}
	pools.ready["h0-medium"] = 2
	sc.grown["h0-medium"] = time.Now().Add(-time.Minute)
	p.grow(context.Background(), "h0-medium")
	if pools.replicas["h0-medium"] != 3 {
		t.Fatalf("did not grow a ready pool: %d", pools.replicas["h0-medium"])
	}
}

// A pod marked for a shrink and taken before it went loses its mark, so the ReplicaSet does not pick it later.
func TestShrinkUnmarksTaken(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{workers: []sandbox.Worker{{Pool: "h0-medium", Pod: "a"}, {Pool: "h0-medium", Pod: "b"}}}
	pools := &fakePools{replicas: map[string]int{"h0-medium": 2}, costs: map[string]int{}}
	p := &Scaler{Sandboxes: sb, Pools: pools, DB: newDB(t)}
	ctx := context.Background()
	p.shrink(ctx)
	p.shrink(ctx)
	if pools.replicas["h0-medium"] != 0 || pools.costs["a"] != -1000 || pools.costs["b"] != -1000 {
		t.Fatalf("replicas %d costs %v", pools.replicas["h0-medium"], pools.costs)
	}
	// "b" was resumed onto before the ReplicaSet removed it.
	sb.workers = []sandbox.Worker{{Pool: "h0-medium", Pod: "b", Held: []sandbox.Held{{Name: "a", State: "running"}}}}
	pools.replicas["h0-medium"] = 1
	p.shrink(ctx)
	if pools.costs["b"] != 0 {
		t.Fatalf("a taken pod kept its mark: %v", pools.costs)
	}
}

// A woken actor's boxd may be on its environment's token, so a check made before it slept no longer counts.
func TestResumeTellsWoken(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{states: map[string]string{"a": "suspended", "b": "running"}}
	var woken []string
	p := &Scaler{Sandboxes: sb, Pools: &fakePools{replicas: map[string]int{}}, DB: newDB(t),
		Woken: func(actor string) { woken = append(woken, actor) }}
	for _, a := range []string{"a", "b"} {
		if err := p.resume(context.Background(), a, ""); err != nil {
			t.Fatal(err)
		}
	}
	if !slices.Equal(woken, []string{"a"}) {
		t.Fatalf("woken %v, want the suspended one only", woken)
	}
}

// A worker held by an actor no row names has it deleted; one assigned an actor Substrate does not know is free.
func TestReap(t *testing.T) {
	sc = newScaler()
	sb := &fakeSandboxes{workers: []sandbox.Worker{
		{Pool: "h0-medium", Pod: "routed", Held: []sandbox.Held{{Name: "shop-b30f1ae1ab", State: "suspending"}}},
		{Pool: "h0-medium", Pod: "forking", Held: []sandbox.Held{{Name: "wt-s1", State: "resuming"}}},
		{Pool: "h0-medium", Pod: "building", Held: []sandbox.Held{{Name: "web-1111111111", State: "running"}}},
		{Pool: "h0-medium", Pod: "golden", Held: []sandbox.Held{{Space: "ate-golden", Name: "97ce8213", State: "running"}}},
		{Pool: "h0-medium", Pod: "failed", Held: []sandbox.Held{{Name: "shop-853d8ecc03", State: "running"}}},
		{Pool: "h0-medium", Pod: "stale", Held: []sandbox.Held{{Name: "gone", State: ""}}},
	}}
	st := newDB(t, sandbox.Route{Actor: "shop-b30f1ae1ab", Tier: "medium"})
	named := func() map[string]bool { return map[string]bool{"wt-s1": true, "web-1111111111": true} }
	p := &Scaler{Sandboxes: sb, Pools: &fakePools{replicas: map[string]int{}}, DB: st, Named: named}
	if err := p.reap(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(sb.deleted, []string{"shop-853d8ecc03"}) {
		t.Fatalf("deleted %v", sb.deleted)
	}
	if sb.workers[5].Assigned() || !sb.workers[3].Assigned() {
		t.Fatal("a stale assignment holds its worker, or a golden actor does not")
	}
}
