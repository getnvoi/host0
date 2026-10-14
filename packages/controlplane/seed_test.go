package controlplane

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

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

// Every update the bus publishes from now on.
func tap(t *testing.T) chan entry {
	c := make(chan entry, 1024)
	bus.mu.Lock()
	bus.subs[c] = struct{}{}
	bus.mu.Unlock()
	t.Cleanup(func() {
		bus.mu.Lock()
		if _, ok := bus.subs[c]; ok {
			delete(bus.subs, c)
			close(c)
		}
		bus.mu.Unlock()
	})
	return c
}

// The seed updates for env until its build rests, and the seed it rested on.
func seedUpdates(t *testing.T, c chan entry, env string) ([]contract.Seed, contract.Seed) {
	t.Helper()
	var all []contract.Seed
	deadline := time.After(10 * time.Second)
	for {
		select {
		case e := <-c:
			var u contract.Update
			if err := json.Unmarshal(e.data, &u); err != nil {
				t.Fatal(err)
			}
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

func steps(seeds []contract.Seed) []string {
	var out []string
	for _, s := range seeds {
		if s.Step != "" && (len(out) == 0 || out[len(out)-1] != s.Step) {
			out = append(out, s.Step)
		}
	}
	return out
}

type seeder struct{ *sandbox }

func (seeder) Template(context.Context, string, tiers.Tier, []Container) (string, error) {
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
	p := &Plane{Store: newStore(), Cluster: "dev", Zone: "nvoi.to", BoxToken: "box", Edge: edgeless{},
		Sandboxes: seeder{&sandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}},
		Pin:       func(_ context.Context, image string) (string, error) { return image, nil }}
	p.Store.Put("environments", "shop", contract.Environment{Name: "shop", Repo: "acme/shop", Branch: "main",
		Setup: []string{"npm ci"}, Services: []contract.Service{{Name: "web"}}, Preview: 3000})
	p.Store.Put("credentials", "default", contract.Credentials{})
	c := tap(t)
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
	p := &Plane{Store: newStore(), Cluster: "dev", Zone: "nvoi.to", BoxToken: "box", Edge: edgeless{},
		Sandboxes: seeder{&sandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}},
		Pin:       func(_ context.Context, image string) (string, error) { return image, nil }}
	p.Store.Put("environments", "shop", contract.Environment{Name: "shop", Repo: "acme/shop", Branch: "main",
		Setup: []string{"npm ci"}, Preview: 3000})
	p.Store.Put("credentials", "default", contract.Credentials{})
	c := tap(t)
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
	c := tap(t)
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
	p, _ := handler(t)
	p.Store.Put("seeds", "hb", contract.Seed{Env: "hb", State: "building", Step: "setup: bundle install"})
	tails.Store("hb", &progress{line: "Installing rails 8.0.2", lines: 40})
	t.Cleanup(func() { tails.Delete("hb") })
	c := tap(t)
	done := make(chan struct{})
	go p.heartbeat("hb", 10*time.Millisecond, done)
	defer close(done)
	for {
		var u contract.Update
		json.Unmarshal((<-c).data, &u)
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

func TestApprovalShow(t *testing.T) {
	p, h := handler(t)
	at := time.Date(2026, 10, 14, 9, 30, 0, 0, time.UTC)
	p.Store.Put("approvals", "ap1", contract.Approval{ID: "ap1", Session: "s1", Tool: "push_branch",
		Input: `{"branch":"fix-cart"}`, State: "done", Outcome: "pushed fix-cart", Decided: at, By: "ben"})
	res := call(h, "GET", "api-dev.nvoi.to", "/approvals/ap1", "", bearer)
	var a contract.Approval
	json.NewDecoder(res.Body).Decode(&a)
	if res.Code != 200 || a.By != "ben" || !a.Decided.Equal(at) || a.Outcome != "pushed fix-cart" {
		t.Fatalf("%d %+v", res.Code, a)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/approvals/nope", "", bearer); res.Code != http.StatusNotFound {
		t.Fatalf("unknown approval: %d %s", res.Code, res.Body.String())
	}
}
