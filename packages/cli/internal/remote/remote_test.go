package remote

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/state"
)

// A plane whose stream runs script on each connection: n counts from 1, last is the Last-Event-ID it was opened with.
type plane struct {
	mu     sync.Mutex
	conns  int
	asks   int
	asked  chan struct{}
	script func(w *sse, n int, last string)
}

type sse struct {
	w  http.ResponseWriter
	r  *http.Request
	id int
}

func (s *sse) send(u contract.Update) {
	s.id++
	b, _ := json.Marshal(u)
	fmt.Fprintf(s.w, "id: run-%d\ndata: %s\n\n", s.id, b)
	s.w.(http.Flusher).Flush()
}

func (s *sse) seed(st contract.Seed) {
	st.Env = "shop"
	s.send(contract.Update{Kind: "seed", Seed: &st})
}

func serve(t *testing.T, p *plane) state.State {
	p.asked = make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /stream", func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		p.conns++
		n := p.conns
		p.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "id: run-0\nretry: 2000\n\n")
		w.(http.Flusher).Flush()
		p.script(&sse{w: w, r: r}, n, r.Header.Get("Last-Event-ID"))
	})
	mux.HandleFunc("POST /environments/shop/seed", func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		if p.asks++; p.asks == 1 {
			close(p.asked)
		}
		p.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	})
	mux.HandleFunc("POST /previews", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"url":"https://shop-dev.nvoi.to/?gate=t0k"}`)
	})
	mux.HandleFunc("GET /approvals/ap1", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(contract.Approval{ID: "ap1", Session: "s1", Tool: "push_branch",
			Input: `{"branch":"fix-cart"}`, State: "done", Outcome: "pushed fix-cart",
			At: time.Date(2026, 10, 14, 9, 29, 0, 0, time.UTC), Decided: time.Date(2026, 10, 14, 9, 30, 0, 0, time.UTC), By: "ben"})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Setenv("HOME", t.TempDir())
	st := state.State{URL: srv.URL, Token: "cli-token"}
	if err := state.Save(st); err != nil {
		t.Fatal(err)
	}
	return st
}

func seeding(t *testing.T, p *plane) (string, error) {
	st := serve(t, p)
	var out bytes.Buffer
	err := (&build{st: st, env: "shop", out: &out}).follow()
	t.Logf("hz env seed shop\n%s%v", out.String(), err)
	return out.String(), err
}

func TestSeedPrintsEachStep(t *testing.T) {
	p := &plane{}
	p.script = func(s *sse, _ int, _ string) {
		<-p.asked
		s.send(contract.Update{Kind: "session", Session: &contract.Summary{ID: "other"}})
		s.seed(contract.Seed{State: "building", Step: "starting"})
		s.seed(contract.Seed{State: "building", Step: "cloning acme/shop@main"})
		s.seed(contract.Seed{State: "building", Step: "setup: npm ci"})
		s.seed(contract.Seed{State: "building", Step: "setup: npm ci", Line: "added 12 packages"})
		s.seed(contract.Seed{State: "building", Step: "setup: npm ci", Line: "added 12 packages"})
		s.seed(contract.Seed{State: "building", Step: "waiting for the app on port 3000"})
		s.seed(contract.Seed{State: "building", Step: "snapshotting tpl"})
		s.seed(contract.Seed{State: "ready", Preview: "shop-dev.nvoi.to"})
	}
	out, err := seeding(t, p)
	if err != nil {
		t.Fatal(err)
	}
	want := `  starting
  cloning acme/shop@main
  setup: npm ci
    added 12 packages
  waiting for the app on port 3000
  snapshotting tpl
seed ready: https://shop-dev.nvoi.to/?gate=t0k
`
	if out != want {
		t.Fatalf("printed\n%s\nwant\n%s", out, want)
	}
}

func TestSeedFailsWithThePlanesSentence(t *testing.T) {
	p := &plane{}
	p.script = func(s *sse, _ int, _ string) {
		<-p.asked
		s.seed(contract.Seed{State: "building", Step: "setup: bundle install"})
		s.seed(contract.Seed{State: "failed", Step: "setup: bundle install",
			Error: "seed-1 exited 5: Could not find gem 'rails (~> 9.0)'"})
	}
	_, err := seeding(t, p)
	if err == nil || err.Error() != "seed failed: seed-1 exited 5: Could not find gem 'rails (~> 9.0)'" {
		t.Fatalf("error %v", err)
	}
}

func TestSeedSilenceIsAHang(t *testing.T) {
	silence = 100 * time.Millisecond
	t.Cleanup(func() { silence = 10 * time.Second })
	p := &plane{}
	p.script = func(s *sse, _ int, _ string) {
		<-p.asked
		// Beats that repeat the step and the output count are no progress.
		for {
			s.seed(contract.Seed{State: "building", Step: "setup: npm ci", Line: "added 12 packages", Lines: 3})
			select {
			case <-s.r.Context().Done():
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}
	_, err := seeding(t, p)
	if err == nil || err.Error() != `no progress on the seed of shop for 100ms; last step: setup: npm ci; last line: "added 12 packages"` {
		t.Fatalf("error %v", err)
	}
}

func TestSeedReconnectsWhereItLeft(t *testing.T) {
	backoff = time.Millisecond
	t.Cleanup(func() { backoff = time.Second })
	p := &plane{}
	var resumed string
	p.script = func(s *sse, n int, last string) {
		<-p.asked
		if n == 1 {
			s.seed(contract.Seed{State: "building", Step: "cloning acme/shop@main"})
			return
		}
		resumed = last
		s.id = 1
		s.seed(contract.Seed{State: "ready", Preview: "shop-dev.nvoi.to"})
	}
	out, err := seeding(t, p)
	if err != nil || resumed != "run-1" || p.asks != 1 || !strings.Contains(out, "stream dropped (the plane closed the stream), reconnecting") {
		t.Fatalf("resumed after %q, asked %d times: %v", resumed, p.asks, err)
	}
}

func TestSeedGivesUpAfterFourDrops(t *testing.T) {
	backoff = time.Millisecond
	t.Cleanup(func() { backoff = time.Second })
	p := &plane{}
	p.script = func(*sse, int, string) {}
	_, err := seeding(t, p)
	if err == nil || err.Error() != "the plane's stream dropped 4 times in a row: the plane closed the stream" || p.conns != 4 {
		t.Fatalf("%d connections: %v", p.conns, err)
	}
}

func TestApprovalShow(t *testing.T) {
	serve(t, &plane{script: func(*sse, int, string) {}})
	var a contract.Approval
	if err := call("GET", "/approvals/ap1", nil, &a); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	showApproval(&out, a)
	t.Logf("hz approval show ap1\n%s", out.String())
	want := `id       ap1
session  s1
tool     push_branch
state    done
asked    2026-10-14T09:29:00Z
decided  2026-10-14T09:30:00Z by ben
outcome  pushed fix-cart
input
{"branch":"fix-cart"}
`
	if out.String() != want {
		t.Fatalf("printed\n%s", out.String())
	}
}
