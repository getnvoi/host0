package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/getnvoi/host0/internal/box"
)

const planeToken = "ghs_plane_only"

// No GitHub credential, by name or by value, in what the sandbox is given.
func credentialFree(t *testing.T, where string, env map[string]string) {
	t.Helper()
	for k, v := range env {
		if strings.Contains(strings.ToUpper(k), "GITHUB") || k == "GH_TOKEN" || strings.Contains(v, planeToken) {
			t.Fatalf("%s carries %s=%q", where, k, v)
		}
	}
}

// The seed's checkout is fetched with the plane's token and arrives in the sandbox as a bundle; the containers,
// the seed run and its script carry no GitHub credential.
func TestSeedHoldsNoGitHubToken(t *testing.T) {
	var seen seedRun
	srv := httptest.NewServer(seedBoxd(&seen))
	t.Cleanup(srv.Close)
	p := newWorkspace(t, seeder{&fakeSandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}})
	if err := p.PutCredentials(Credentials{GitHub: planeToken}); err != nil {
		t.Fatal(err)
	}
	env(t, p, Environment{Name: "shop", Repo: "acme/shop", Branch: "main", Env: map[string]string{"RAILS_ENV": "development"},
		Secrets: map[string]string{"RAILS_MASTER_KEY": "k"}, Services: []Service{{Name: "web", Command: "rails s"}}, Preview: 3000})
	c := p.Bus.(*bus).tap(t)
	if err := p.Reseed("shop"); err != nil {
		t.Fatal(err)
	}
	if _, last := seedUpdates(t, c, "shop"); last.State != "ready" {
		t.Fatalf("rested on %+v", last)
	}
	f := p.Forge.(*forge)
	if len(f.tokens) != 1 || f.tokens[0] != planeToken {
		t.Fatalf("the forge took %q", f.tokens)
	}
	seen.mu.Lock()
	defer seen.mu.Unlock()
	if got := seen.files[checkoutBundle]; got != "acme/shop@main" {
		t.Fatalf("the sandbox received %q at %s; files %v", got, checkoutBundle, seen.files)
	}
	credentialFree(t, "the seed run", seen.env)
	for _, bad := range []string{planeToken, "GITHUB", "x-access-token"} {
		if strings.Contains(seen.script, bad) {
			t.Fatalf("the seed script names %s:\n%s", bad, seen.script)
		}
	}
	for _, want := range []string{"git clone -q --branch main " + checkoutBundle + " " + App,
		"remote set-url origin https://github.com/acme/shop", "rm -f " + checkoutBundle} {
		if !strings.Contains(seen.script, want) {
			t.Fatalf("no %q in the seed script:\n%s", want, seen.script)
		}
	}
	e, err := p.Environment("shop")
	if err != nil {
		t.Fatal(err)
	}
	cs, err := p.containers(context.Background(), e)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cs {
		credentialFree(t, "container "+c.Name, c.Env)
		if strings.Contains(strings.Join(c.Command, " "), planeToken) {
			t.Fatalf("container %s's command carries the token", c.Name)
		}
	}
}

// A push bundles HEAD in the sandbox with no credential in its run; the plane reads it back and pushes it.
func TestPushBundlesInTheSandboxAndPushesFromThePlane(t *testing.T) {
	const bundle = "the session's HEAD, bundled"
	var mu sync.Mutex
	var runs []box.Run
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/run/"):
			var run box.Run
			json.NewDecoder(r.Body).Decode(&run)
			runs = append(runs, run)
		case strings.HasSuffix(r.URL.Path, "/log"):
			w.Header().Set("X-Exit", "0")
		case r.URL.Path == "/tail" && r.URL.Query().Get("path") == pushBundle:
			at, _ := strconv.Atoi(r.URL.Query().Get("offset"))
			end := min(at+8, len(bundle))
			w.Header().Set("X-Offset", strconv.Itoa(end))
			w.Write([]byte(bundle[at:end]))
		case r.URL.Path == "/token" || r.URL.Path == "/health":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	p := newWorkspace(t, &fakeSandbox{boxed: boxed{addr: srv.Listener.Addr().String()}})
	if err := p.PutCredentials(Credentials{GitHub: planeToken}); err != nil {
		t.Fatal(err)
	}
	sessionRow(t, p, Session{ID: "s1", Env: "web", Actor: "wt-s1", Branch: "h0/s1", State: "idle"})
	got, err := p.Push(context.Background(), "s1")
	if err != nil || got.Branch != "h0/s1" {
		t.Fatalf("pushed %+v, err %v", got, err)
	}
	f := p.Forge.(*forge)
	if f.pushed["h0/s1"] != bundle || len(f.tokens) != 1 || f.tokens[0] != planeToken {
		t.Fatalf("the forge pushed %q with %q", f.pushed, f.tokens)
	}
	if len(runs) != 1 || !strings.Contains(strings.Join(runs[0].Argv, " "), "git bundle create -q "+pushBundle+" HEAD") {
		t.Fatalf("runs %+v", runs)
	}
	credentialFree(t, "the push run", runs[0].Env)
}
