package workspace

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/llm/claude"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/scm"
	"github.com/getnvoi/host0/internal/shared/seal"
)

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

// Tools that do nothing: what an operation does is the API's, in cmd/controlplane.
type idle struct{}

func (idle) List() []Tool {
	return []Tool{{Name: "session_title", Default: "auto"}, {Name: "session_navigate", Default: "auto"},
		{Name: "session_push", Default: "approval"}, {Name: "session_pr", Default: "approval"}}
}
func (idle) Call(_ context.Context, _, _, name, _ string) string { return name + ": done" }

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

// A forge whose bundle of repo@branch is that text; it keeps the token each call took and each bundle pushed.
type forge struct {
	mu     sync.Mutex
	tokens []string
	pushed map[string]string // branch: the bundle's bytes
}

func (f *forge) PullRequest(_ context.Context, token, repo, head, _, _, _ string) (string, error) {
	f.took(token)
	return "https://github.com/" + repo + "/pull/" + head, nil
}

func (f *forge) Bundle(_ context.Context, token, repo, branch, out string, line func(string)) error {
	f.took(token)
	line("Receiving objects: 100%")
	return os.WriteFile(out, []byte(repo+"@"+branch), 0o600)
}

func (f *forge) Push(_ context.Context, token, _, bundle, branch string) error {
	f.took(token)
	b, err := os.ReadFile(bundle)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.pushed == nil {
		f.pushed = map[string]string{}
	}
	f.pushed[branch] = string(b)
	return err
}

func (f *forge) Repositories(_ context.Context, token string) ([]scm.Repository, error) {
	f.took(token)
	return []scm.Repository{{FullName: "o/r", DefaultBranch: "main"}}, nil
}

func (f *forge) took(token string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens = append(f.tokens, token)
}

// A workspace on sb, its rows in memory. Its turns run claude's real parsing of what the fake boxd prints.
func newWorkspace(t *testing.T, sb sandbox.Sandboxes) *Workspace {
	return &Workspace{DB: newDB(t), Cluster: "dev", Zone: "nvoi.to", BoxToken: "box", Edge: edgeless{}, Forge: &forge{},
		Sandboxes: sb, Workers: roomy{sb}, Tools: idle{}, Bus: &bus{}, Runners: []llm.Runner{claude.Runner{API: anthropic(t)}},
		Pin: func(_ context.Context, image string) (string, error) { return image, nil }}
}

// The Messages API: the captured answer to a credential, its authentication_error to the token "bad".
func anthropic(t *testing.T) string {
	ok, err := os.ReadFile("../llm/testdata/anthropic-200.json")
	if err != nil {
		t.Fatal(err)
	}
	refused, err := os.ReadFile("../llm/testdata/anthropic-401.json")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if r.Header.Get("x-api-key") == "bad" || r.Header.Get("authorization") == "Bearer bad" {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write(refused)
			return
		}
		w.Write(ok)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// A database in a fresh file, migrated.
func newDB(t *testing.T) *gorm.DB {
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

// Declares e, as PUT /environments/{name} does.
func env(t *testing.T, p *Workspace, e Environment) {
	t.Helper()
	if err := p.PutEnvironment(EnvironmentInput(e)); err != nil {
		t.Fatal(err)
	}
}

// Writes s as a seed's row, its environment declared first if it is not.
func seedRow(t *testing.T, p *Workspace, s Seed) {
	t.Helper()
	if _, err := p.Environment(s.Env); err != nil {
		env(t, p, Environment{Name: s.Env})
	}
	if err := p.putSeed(&s); err != nil {
		t.Fatal(err)
	}
}

// Writes s as a session's rows, its environment (web when it names none) declared first if it is not.
func sessionRow(t *testing.T, p *Workspace, s Session) {
	t.Helper()
	if s.Env == "" {
		s.Env = "web"
	}
	if _, err := p.Environment(s.Env); err != nil {
		env(t, p, Environment{Name: s.Env})
	}
	if err := p.write(&s); err != nil {
		t.Fatal(err)
	}
}

func approvalRow(t *testing.T, p *Workspace, a Approval) {
	t.Helper()
	if err := p.putApproval(a); err != nil {
		t.Fatal(err)
	}
}

func queueRows(t *testing.T, p *Workspace, sid string, msgs ...string) {
	t.Helper()
	for _, m := range msgs {
		if err := p.enqueue(sid, m); err != nil {
			t.Fatal(err)
		}
	}
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
