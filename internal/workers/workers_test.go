package workers

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/naming"
)

// The servers of one cluster, by name, as a cloud keeps them.
type fakeCloud struct {
	cloud.Cloud
	servers map[string]cloud.Spec
	made    []string
	deleted []string
}

func (f *fakeCloud) List(context.Context, naming.Cluster) ([]cloud.Server, error) {
	var out []cloud.Server
	for name := range f.servers {
		out = append(out, cloud.Server{ID: name, Name: name})
	}
	return out, nil
}

func (f *fakeCloud) Server(_ context.Context, _ naming.Cluster, s cloud.Spec) (cloud.Server, error) {
	if _, ok := f.servers[s.Name]; !ok {
		f.servers[s.Name] = s
		f.made = append(f.made, s.Name)
	}
	return cloud.Server{ID: s.Name, Name: s.Name}, nil
}

func (f *fakeCloud) Delete(_ context.Context, name string) error {
	delete(f.servers, name)
	f.deleted = append(f.deleted, name)
	return nil
}

func servers(names ...string) *fakeCloud {
	f := &fakeCloud{servers: map[string]cloud.Spec{}}
	for _, n := range names {
		f.servers[n] = cloud.Spec{Name: n}
	}
	return f
}

var long = time.Now().Add(-time.Hour)

func node(name string) kube.Node { return kube.Node{Name: name, Ready: true, Created: long} }

func workerScaler(cl *fakeCloud, pools *fakePools, routes ...sandbox.Route) *Scaler {
	fl = &fleet{free: map[string]time.Time{}}
	return &Scaler{Cluster: "dev", Cloud: func(location string) (cloud.Cloud, error) {
		if location != "fsn1" {
			return nil, fmt.Errorf("location %q", location)
		}
		return cl, nil
	}, WorkerInit: "#cloud-config", Pools: pools, Store: newStore(routes...),
		Sandboxes: &fakeSandboxes{states: map[string]string{}}}
}

func TestPlaceNamesTheLowestFreeWorker(t *testing.T) {
	cl := servers("hz-dev-w1", "hz-dev-w3", "hz-dev-control")
	pools := &fakePools{unplaced: 1, nodes: []kube.Node{node("hz-dev-w1"), node("hz-dev-w3"), node("hz-dev-control")}}
	p := workerScaler(cl, pools)
	p.Store.Put("cluster", "shape", sandbox.Shape{Workers: sandbox.Servers{Type: "ccx23", Location: "fsn1", Max: 3}, Tiers: testShape.Tiers})
	var said []string
	ctx := sandbox.WithProgress(context.Background(), func(l string) { said = append(said, l) })
	name, err := p.place(ctx)
	if err != nil || name != "hz-dev-w2" || !slices.Equal(cl.made, []string{"hz-dev-w2"}) {
		t.Fatalf("placed %q, made %v: %v", name, cl.made, err)
	}
	if s := cl.servers["hz-dev-w2"]; s.Type != "ccx23" || s.PrivateIP != "10.0.1.12" || s.Init != "#cloud-config" {
		t.Fatalf("spec %+v", s)
	}
	if !slices.Equal(said, []string{"creating server hz-dev-w2 (ccx23, fsn1)"}) {
		t.Fatalf("said %q", said)
	}
}

func TestPlaceWaitsForAJoiningWorker(t *testing.T) {
	cl := servers("hz-dev-w1")
	p := workerScaler(cl, &fakePools{unplaced: 1})
	if name, err := p.place(context.Background()); err != nil || name != "hz-dev-w1" || len(cl.made) > 0 {
		t.Fatalf("placed %q, made %v: %v", name, cl.made, err)
	}
	fresh := kube.Node{Name: "hz-dev-w1", Ready: true, Created: time.Now()}
	p.Pools.(*fakePools).nodes = []kube.Node{fresh}
	if name, err := p.place(context.Background()); err != nil || name != "hz-dev-w1" || len(cl.made) > 0 {
		t.Fatalf("a node ready a moment ago: placed %q, made %v: %v", name, cl.made, err)
	}
}

func TestPlaceRefusesPastMax(t *testing.T) {
	cl := servers("hz-dev-w1", "hz-dev-w2")
	p := workerScaler(cl, &fakePools{unplaced: 1, nodes: []kube.Node{node("hz-dev-w1"), node("hz-dev-w2")}})
	_, err := p.place(context.Background())
	if err == nil || !strings.Contains(err.Error(), "workers are at their max of 2") || len(cl.made) > 0 {
		t.Fatalf("made %v: %v", cl.made, err)
	}
}

func TestPlaceNothingWhenEveryPodHasANode(t *testing.T) {
	cl := servers()
	p := workerScaler(cl, &fakePools{})
	if name, err := p.place(context.Background()); err != nil || name != "" || len(cl.made) > 0 {
		t.Fatalf("placed %q, made %v: %v", name, cl.made, err)
	}
}

func TestRetireAnIdleWorker(t *testing.T) {
	cl := servers("hz-dev-control", "hz-dev-w1", "hz-dev-w2", "hz-dev-w3", "hz-dev-w4")
	recent := kube.Node{Name: "hz-dev-w3", Ready: true, Created: time.Now()}
	pools := &fakePools{occupants: map[string]int{"hz-dev-w2": 1},
		nodes: []kube.Node{node("hz-dev-control"), node("hz-dev-w1"), node("hz-dev-w2"), recent, node("n1")}}
	p := workerScaler(cl, pools, sandbox.Route{Actor: "a", Port: 3000, Tier: "medium"})
	p.Sandboxes.(*fakeSandboxes).states["a"] = "paused"
	// a is paused on n1, no worker; w2 holds a pod, w3 joined a moment ago, w4 has not joined.
	if err := p.retire(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(cl.deleted) > 0 {
		t.Fatalf("deleted %v at first sight", cl.deleted)
	}
	for name := range fl.free {
		fl.free[name] = time.Now().Add(-2 * time.Minute)
	}
	if err := p.retire(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(cl.deleted, []string{"hz-dev-w1"}) || !slices.Equal(pools.forgot, []string{"hz-dev-w1"}) || !pools.cordoned["hz-dev-w1"] {
		t.Fatalf("deleted %v, forgot %v, cordoned %v", cl.deleted, pools.forgot, pools.cordoned)
	}
	// One not joined goes after joinWait.
	fl.free["hz-dev-w4"] = time.Now().Add(-joinWait - time.Minute)
	if err := p.retire(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(cl.deleted, []string{"hz-dev-w1", "hz-dev-w4"}) {
		t.Fatalf("deleted %v", cl.deleted)
	}
}

func TestRetireKeepsThePausedActorsNode(t *testing.T) {
	cl := servers("hz-dev-w1")
	pools := &fakePools{nodes: []kube.Node{node("hz-dev-w1")}}
	p := workerScaler(cl, pools, sandbox.Route{Actor: "a", Port: 3000, Tier: "medium"})
	p.Sandboxes = pausedOn{&fakeSandboxes{states: map[string]string{"a": "paused"}}, "hz-dev-w1"}
	fl.free["hz-dev-w1"] = time.Now().Add(-time.Hour)
	if err := p.retire(context.Background()); err != nil || len(cl.deleted) > 0 {
		t.Fatalf("deleted %v: %v", cl.deleted, err)
	}
}

type pausedOn struct {
	*fakeSandboxes
	node string
}

func (s pausedOn) Node(context.Context, string) (string, error) { return s.node, nil }

func TestRetireForgetsANodeWhoseServerIsGone(t *testing.T) {
	pools := &fakePools{nodes: []kube.Node{{Name: "hz-dev-w1", Created: long}, node("hz-dev-w2")}}
	p := workerScaler(servers("hz-dev-w2"), pools)
	if err := p.retire(context.Background()); err != nil || !slices.Equal(pools.forgot, []string{"hz-dev-w1"}) {
		t.Fatalf("forgot %v: %v", pools.forgot, err)
	}
}

// A plane that starts again has its workers from the cloud and the nodes: the next name skips them, the idle clock
// starts over.
func TestRestartPicksUpWorkers(t *testing.T) {
	cl := servers("hz-dev-w1", "hz-dev-w2")
	pools := &fakePools{unplaced: 1, nodes: []kube.Node{node("hz-dev-w1"), node("hz-dev-w2")}}
	p := workerScaler(cl, pools)
	p.Store.Put("cluster", "shape", sandbox.Shape{Workers: sandbox.Servers{Type: "ccx23", Location: "fsn1", Max: 5, Idle: time.Minute}, Tiers: testShape.Tiers})
	if name, err := p.place(context.Background()); err != nil || name != "hz-dev-w3" {
		t.Fatalf("placed %q: %v", name, err)
	}
	pools.unplaced = 0
	if err := p.retire(context.Background()); err != nil || len(cl.deleted) > 0 {
		t.Fatalf("deleted %v after a restart: %v", cl.deleted, err)
	}
	if len(fl.free) != 3 {
		t.Fatalf("idle clocks %v", fl.free)
	}
}

func TestNoCloudMakesNoWorker(t *testing.T) {
	p := &Scaler{Cluster: "dev", Pools: &fakePools{unplaced: 1}, Store: newStore()}
	if name, err := p.place(context.Background()); err != nil || name != "" {
		t.Fatalf("%q %v", name, err)
	}
	if err := p.retire(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestShapeIsRequired(t *testing.T) {
	p := &Scaler{Store: &fakeStore{kv: map[string]map[string][]byte{}}}
	if _, err := p.Tier(""); err == nil || !strings.Contains(err.Error(), "hz cluster install writes it") {
		t.Fatal(err)
	}
	if err := p.SetShape(sandbox.Shape{}); err == nil {
		t.Fatal("a shape with no default tier is taken")
	}
}
