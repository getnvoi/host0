package workspace

import (
	"context"
	"encoding/json"
	"net"
	"sync"
	"testing"

	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/llm/claude"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/store"
)

// Records are kept as JSON, as the real store keeps them: what is read back is a copy, never the writer's value.
type fakeStore struct {
	mu sync.Mutex
	kv map[string]map[string][]byte
}

func newStore() *fakeStore { return &fakeStore{kv: map[string]map[string][]byte{}} }

func (f *fakeStore) Get(kind, id string, v any) error {
	f.mu.Lock()
	b, ok := f.kv[kind][id]
	f.mu.Unlock()
	if !ok {
		return store.ErrNotFound
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

// Workers with room for every actor: a tier is one of the defaults, an actor not running is resumed.
type roomy struct{ sb sandbox.Sandboxes }

func (r roomy) Tier(name string) (sandbox.Tier, error) {
	return sandbox.Pick(sandbox.DefaultTiers, name)
}

func (r roomy) Ensure(ctx context.Context, actor, _ string) error {
	if state, err := r.sb.State(ctx, actor); err != nil || state == "running" {
		return err
	}
	return r.sb.Resume(ctx, actor)
}

func (r roomy) Enter(ctx context.Context, actor, tier string) (func(), error) {
	return func() {}, r.Ensure(ctx, actor, tier)
}

func (r roomy) Wake(ctx context.Context, actor string, _ sandbox.Tier) error {
	return r.sb.Resume(ctx, actor)
}

// Tools that do nothing: what the tools do is the tools package's.
type idle struct{}

func (idle) Spec() []map[string]any { return []map[string]any{} }
func (idle) Policy(name string) string {
	return map[string]string{"set_title": "auto", "navigate_preview": "auto"}[name]
}
func (idle) Do(_ context.Context, _ *Target, name, _ string) string { return name + ": done" }

// Every update published, to whoever taps it, as the stream would carry it.
type bus struct {
	mu   sync.Mutex
	subs map[chan Update]struct{}
}

func (b *bus) Publish(v any) {
	data, _ := json.Marshal(v)
	var u Update
	json.Unmarshal(data, &u)
	b.mu.Lock()
	defer b.mu.Unlock()
	for c := range b.subs {
		select {
		case c <- u:
		default:
		}
	}
}

// Every update published from now on.
func (b *bus) tap(t *testing.T) chan Update {
	c := make(chan Update, 1024)
	b.mu.Lock()
	if b.subs == nil {
		b.subs = map[chan Update]struct{}{}
	}
	b.subs[c] = struct{}{}
	b.mu.Unlock()
	t.Cleanup(func() {
		b.mu.Lock()
		delete(b.subs, c)
		b.mu.Unlock()
	})
	return c
}

// A workspace on sb, its rows in memory. Its turns run claude's real parsing of what the fake boxd prints.
func newWorkspace(sb sandbox.Sandboxes) *Workspace {
	return &Workspace{Store: newStore(), Cluster: "dev", Zone: "nvoi.to", BoxToken: "box", Edge: edgeless{},
		Sandboxes: sb, Workers: roomy{sb}, Tools: idle{}, Bus: &bus{}, Runners: []llm.Runner{claude.Runner{}},
		Pin: func(_ context.Context, image string) (string, error) { return image, nil }}
}

// A sandbox whose every port is one boxd stand-in.
type boxed struct {
	sandbox.Sandboxes
	addr string
}

func (b boxed) State(context.Context, string) (string, error) { return "running", nil }
func (b boxed) Dial(ctx context.Context, _ string, _ int) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "tcp", b.addr)
}

// Records the actors deleted.
type removing struct {
	sandbox.Sandboxes
	mu   sync.Mutex
	gone []string
}

func (r *removing) Delete(_ context.Context, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gone = append(r.gone, name)
	return nil
}
