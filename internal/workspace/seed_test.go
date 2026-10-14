package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/sandbox"
)

// The seed updates for env until its build rests, and the seed it rested on.
func seedUpdates(t *testing.T, c chan Update, env string) ([]Seed, Seed) {
	t.Helper()
	var all []Seed
	deadline := time.After(10 * time.Second)
	for {
		select {
		case u := <-c:
			if u.Kind != "seed" || u.Seed.Env != env {
				continue
			}
			all = append(all, *u.Seed)
			if u.Seed.State != "building" {
				return all, *u.Seed
			}
		case <-deadline:
			t.Fatalf("the build of %s never rested; updates %+v", env, all)
		}
	}
}

func steps(seeds []Seed) []string {
	var out []string
	for _, s := range seeds {
		if s.Step != "" && (len(out) == 0 || out[len(out)-1] != s.Step) {
			out = append(out, s.Step)
		}
	}
	return out
}

type seeder struct{ *fakeSandbox }

func (seeder) Template(context.Context, string, sandbox.Tier, []sandbox.Container) (string, error) {
	return "tpl", nil
}
func (seeder) Suspend(context.Context, string) error     { return nil }
func (seeder) Tag(context.Context, string, string) error { return nil }

// A boxd whose seed script prints the steps it announces and one line of its own, then exits 0.
func seedBoxd(script *string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/run/"):
			var run struct{ Argv []string }
			json.NewDecoder(r.Body).Decode(&run)
			*script = run.Argv[2]
		case strings.HasSuffix(r.URL.Path, "/log"):
			w.Header().Set("X-Exit", "0")
			if r.URL.Query().Get("offset") != "0" {
				return
			}
			for _, l := range strings.Split(*script, "\n") {
				if what, ok := strings.CutPrefix(l, "echo '"+stepMark); ok {
					w.Write([]byte(stepMark + strings.TrimSuffix(what, "'") + "\n"))
				}
			}
			w.Write([]byte("added 12 packages\n"))
		case r.URL.Path == "/token" || r.URL.Path == "/health":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}
}

func TestSeedAnnouncesEachStep(t *testing.T) {
	var script string
	srv := httptest.NewServer(seedBoxd(&script))
	t.Cleanup(srv.Close)
	p := newWorkspace(t, seeder{&fakeSandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}})
	env(t, p, Environment{Name: "shop", Repo: "acme/shop", Branch: "main",
		Setup: []string{"npm ci"}, Services: []Service{{Name: "web"}}, Preview: 3000})
	c := p.Bus.(*bus).tap(t)
	if err := p.Reseed("shop"); err != nil {
		t.Fatal(err)
	}
	all, last := seedUpdates(t, c, "shop")
	if last.State != "ready" || last.Preview == "" {
		t.Fatalf("rested on %+v", last)
	}
	got := strings.Join(steps(all), "\n")
	for _, want := range []string{"starting", "reading the environment", "resolving images", "building the template",
		"starting the sandbox, services: web", "waiting for boxd", "running the seed script", "cloning acme/shop@main",
		"setup: npm ci", "waiting for the app on port 3000", "snapshotting tpl", "tagging tpl-", "routing "} {
		i := strings.Index(got, want)
		if i < 0 {
			t.Fatalf("no step %q in\n%s", want, got)
		}
		got = got[i+len(want):]
	}
}

// A setup step that prints a line and then nothing fails the build with its name and that line, and its run is ended.
func TestSeedSilentStepFails(t *testing.T) {
	silence = 200 * time.Millisecond
	t.Cleanup(func() { silence = 10 * time.Second })
	var script string
	cancelled := make(chan string, 1)
	speak := seedBoxd(&script)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "DELETE":
			cancelled <- r.URL.Path
		case strings.HasSuffix(r.URL.Path, "/log") && r.URL.Query().Get("offset") == "0":
			fmt.Fprintf(w, "%ssetup: npm ci\nadded 12 packages\n", stepMark)
		case strings.HasSuffix(r.URL.Path, "/log"):
			<-r.Context().Done()
		default:
			speak(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	p := newWorkspace(t, seeder{&fakeSandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}})
	env(t, p, Environment{Name: "shop", Repo: "acme/shop", Branch: "main",
		Setup: []string{"npm ci"}, Preview: 3000})
	c := p.Bus.(*bus).tap(t)
	if err := p.Reseed("shop"); err != nil {
		t.Fatal(err)
	}
	_, last := seedUpdates(t, c, "shop")
	if last.State != "failed" || last.Error != `setup: npm ci: no output for 200ms; last line: "added 12 packages"` {
		t.Fatalf("rested on %+v", last)
	}
	if path := <-cancelled; path != "/run/"+last.Run {
		t.Fatalf("cancelled %s, not %s", path, last.Run)
	}
}

func TestSeedFailureCarriesTheError(t *testing.T) {
	p, _ := withBoxd(t)
	c := p.Bus.(*bus).tap(t)
	if err := p.Reseed("web"); err != nil {
		t.Fatal(err)
	}
	all, last := seedUpdates(t, c, "web")
	if last.State != "failed" || last.Error != "no templates here" || last.Step != "building the template" {
		t.Fatalf("rested on %+v after %v", last, steps(all))
	}
}

// Each beat reports the row and the setup's last line, not merely that the build goes on.
func TestSeedHeartbeat(t *testing.T) {
	p := newWorkspace(t, nil)
	seedRow(t, p, Seed{Env: "hb", State: "building", Step: "setup: bundle install"})
	tails.Store("hb", &progress{line: "Installing rails 8.0.2", lines: 40})
	t.Cleanup(func() { tails.Delete("hb") })
	c := p.Bus.(*bus).tap(t)
	done := make(chan struct{})
	go p.heartbeat("hb", 10*time.Millisecond, done)
	defer close(done)
	for {
		u := <-c
		if u.Kind == "seed" && u.Seed.Env == "hb" {
			if u.Seed.Step != "setup: bundle install" || u.Seed.Line != "Installing rails 8.0.2" || u.Seed.Lines != 40 {
				t.Fatalf("beat %+v", u.Seed)
			}
			return
		}
	}
}

// The step a script announces comes out of sh as written, quotes and all.
func TestAnnounce(t *testing.T) {
	out, err := exec.Command("sh", "-c", announce("setup: echo 'it''s' \"$HOME\"")).Output()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSuffix(string(out), "\n"); got != stepMark+"setup: echo 'it''s' \"$HOME\"" {
		t.Fatalf("printed %q", got)
	}
}

// Names each template from the containers, as Substrate's client does, and records what is done to actors.
type named struct {
	*fakeSandbox
	suspended, deleted []string
}

func (n *named) Template(_ context.Context, env string, _ sandbox.Tier, cs []sandbox.Container) (string, error) {
	return env + "-" + spec(cs)[:10], nil
}
func (n *named) Suspend(_ context.Context, a string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.suspended = append(n.suspended, a)
	return nil
}
func (n *named) Delete(_ context.Context, a string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.deleted = append(n.deleted, a)
	return nil
}
func (*named) Tag(context.Context, string, string) error { return nil }

// A restart over a ready seed, with a boxd built since, builds nothing; env suspend takes the routed actor; a
// rebuild then deletes the actor it replaces.
func TestRestartAfterSeedBuildsNothing(t *testing.T) {
	var script string
	srv := httptest.NewServer(seedBoxd(&script))
	t.Cleanup(srv.Close)
	sb := &named{fakeSandbox: &fakeSandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}}
	p := newWorkspace(t, sb)
	p.BoxImage = "boxd@1"
	env(t, p, Environment{Name: "shop", Repo: "acme/shop", Branch: "main", Preview: 3000})
	c := p.Bus.(*bus).tap(t)
	if err := p.Reseed("shop"); err != nil {
		t.Fatal(err)
	}
	if _, last := seedUpdates(t, c, "shop"); last.State != "ready" {
		t.Fatalf("rested on %+v", last)
	}
	first := sb.created
	until(t, "the build to end", func() bool { _, busy := seeding.Load("shop"); return !busy })

	restarted := newWorkspace(t, sb)
	restarted.DB, restarted.Bus, restarted.BoxImage = p.DB, p.Bus, "boxd@2"
	restarted.Recover()
	restarted.Stale()
	if _, busy := seeding.Load("shop"); busy {
		t.Fatal("a restart started a build")
	}
	if len(sb.created) != len(first) {
		t.Fatalf("a restart made actors %v", sb.created[len(first):])
	}
	if row, _ := restarted.SeedOf("shop"); row.State != "ready" || row.Actor != first[0] {
		t.Fatalf("the seed after a restart: %+v", row)
	}
	actor, err := restarted.SuspendSeed(context.Background(), "shop")
	if err != nil || actor != first[0] || sb.suspended[len(sb.suspended)-1] != first[0] {
		t.Fatalf("env suspend took %q (%v), suspended %v; the preview routes to %s", actor, err, sb.suspended, first[0])
	}

	if err := restarted.Reseed("shop"); err != nil {
		t.Fatal(err)
	}
	if _, last := seedUpdates(t, c, "shop"); last.State != "ready" || last.Actor == first[0] {
		t.Fatalf("the rebuild rested on %+v", last)
	}
	until(t, "the rebuild to end", func() bool { _, busy := seeding.Load("shop"); return !busy })
	if actor, _ := restarted.SuspendSeed(context.Background(), "shop"); actor != sb.created[len(sb.created)-1] {
		t.Fatalf("env suspend took %s, not the rebuilt %s", actor, sb.created[len(sb.created)-1])
	}
	if len(sb.deleted) != 1 || sb.deleted[0] != first[0] {
		t.Fatalf("deleted %v; the replaced seed's actor is %s", sb.deleted, first[0])
	}
}
