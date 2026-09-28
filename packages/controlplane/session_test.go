package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getnvoi/host0/controlplane/box"
	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

// A boxd stand-in. Runs end at once with exit 0, except those in hold, which run until cancelled.
type fakeBoxd struct {
	mu      sync.Mutex
	argv    map[string][]string // PUT /run/{id}, by id
	puts    map[string]int
	hold    map[string]chan int
	logs    map[string]bool   // runs whose log exists without a PUT here: started by a previous plane
	lines   map[string]string // output a run has written before it is held
	waiting chan string       // a held run is being followed
}

func newBoxd() *fakeBoxd {
	return &fakeBoxd{argv: map[string][]string{}, puts: map[string]int{}, hold: map[string]chan int{},
		logs: map[string]bool{}, lines: map[string]string{}, waiting: make(chan string, 16)}
}

func (f *fakeBoxd) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {})
	mux.HandleFunc("PUT /run/{id}", func(w http.ResponseWriter, r *http.Request) {
		var run box.Run
		json.NewDecoder(r.Body).Decode(&run)
		f.mu.Lock()
		f.argv[r.PathValue("id")] = run.Argv
		f.puts[r.PathValue("id")]++
		f.mu.Unlock()
	})
	mux.HandleFunc("GET /run/{id}/log", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		c, held := f.hold[r.PathValue("id")]
		out := f.lines[r.PathValue("id")]
		f.mu.Unlock()
		if out != "" && r.URL.Query().Get("offset") == "0" {
			w.Write([]byte(out))
			return
		}
		code := 0
		if held {
			f.waiting <- r.PathValue("id")
			select {
			case code = <-c:
				f.mu.Lock()
				delete(f.hold, r.PathValue("id"))
				f.mu.Unlock()
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("X-Exit", fmt.Sprint(code))
	})
	mux.HandleFunc("DELETE /run/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		c, held := f.hold[r.PathValue("id")]
		f.mu.Unlock()
		if !held {
			http.Error(w, "run has ended", http.StatusConflict)
			return
		}
		c <- 143
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /tail", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Query().Get("path"), Runs+"/"), "/log")
		f.mu.Lock()
		ok := f.logs[id] || f.puts[id] > 0
		f.mu.Unlock()
		if !ok {
			http.Error(w, "no such file", http.StatusNotFound)
			return
		}
		w.Header().Set("X-Offset", "0")
	})
	return mux
}

func (f *fakeBoxd) count(run string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.puts[run]
}

func (f *fakeBoxd) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.puts)
}

// The prompt a turn was started with.
func (f *fakeBoxd) prompt(run string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if a := f.argv[run]; len(a) > 2 {
		return a[2]
	}
	return ""
}

type sandbox struct {
	boxed
	mu      sync.Mutex
	created []string
}

func (s *sandbox) Create(_ context.Context, name, _, _ string) error {
	s.mu.Lock()
	s.created = append(s.created, name)
	s.mu.Unlock()
	return nil
}
func (s *sandbox) Resume(context.Context, string) error { return nil }
func (s *sandbox) Template(context.Context, string, tiers.Tier, []Container) (string, error) {
	return "", errors.New("no templates here")
}

type edgeless struct{}

func (edgeless) Route(context.Context, string) error { return nil }

var tokenSum = func() string {
	sum := sha256.Sum256([]byte("cli-token"))
	return hex.EncodeToString(sum[:])
}()

func withBoxd(t *testing.T) (*Plane, *fakeBoxd) {
	fb := newBoxd()
	srv := httptest.NewServer(fb.handler())
	t.Cleanup(srv.Close)
	p := &Plane{Store: newStore(), Cluster: "dev", Zone: "nvoi.to", BoxToken: "box", Edge: edgeless{},
		Sandboxes: &sandbox{boxed: boxed{addr: srv.Listener.Addr().String()}},
		Pin:       func(_ context.Context, image string) (string, error) { return image, nil }}
	p.Store.Put("environments", "web", contract.Environment{Name: "web", Branch: "main"})
	p.Store.Put("credentials", "default", contract.Credentials{})
	p.Store.Put("llm", testLLM.Name, testLLM)
	return p, fb
}

func session(p *Plane, sid string) contract.Session {
	var s contract.Session
	p.Store.Get("sessions", sid, &s)
	return s
}

func until(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func prompts(s contract.Session) []string {
	var out []string
	for _, e := range s.Events {
		if e.Kind == "prompt" {
			out = append(out, e.Content)
		}
	}
	return out
}

func kinds(s contract.Session) string {
	var out []string
	for _, e := range s.Events {
		out = append(out, e.Kind)
	}
	return strings.Join(out, ",")
}

func rest(t *testing.T, p *Plane, sid string, turns int) contract.Session {
	t.Helper()
	until(t, fmt.Sprintf("%s idle after %d turns", sid, turns), func() bool {
		s := session(p, sid)
		return s.State == "idle" && s.Turns == turns
	})
	return session(p, sid)
}

func TestSayWhileRunningLeavesTheSession(t *testing.T) {
	p, _ := handler(t)
	stored := contract.Session{ID: "w1", State: "running", Events: []contract.Event{{Kind: "prompt", Content: "a"}}}
	p.Store.Put("sessions", "w1", stored)
	before := session(p, "w1")
	if err := p.Say("w1", "next", ""); err != nil {
		t.Fatal(err)
	}
	after := session(p, "w1")
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Fatalf("Say rewrote the session:\n%s\n%s", a, b)
	}
	if q := p.Queue("w1"); len(q) != 1 || q[0] != "next" {
		t.Fatalf("queue %v", q)
	}
}

// Two messages to a session at rest: one runs, the other waits for it, and each turn is started once.
func TestSayRunsOneTurnAtATime(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("sessions", "r1", contract.Session{ID: "r1", Env: "web", Actor: "wt-r1", State: "idle", Forked: true})
	var wg sync.WaitGroup
	for _, m := range []string{"one", "two"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := p.Say("r1", m, ""); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	s := rest(t, p, "r1", 2)
	if got := prompts(s); len(got) != 2 || got[0] == got[1] {
		t.Fatalf("prompts %v", got)
	}
	if fb.count("turn-1") != 1 || fb.count("turn-2") != 1 || fb.count("turn-3") != 0 {
		t.Fatalf("runs %v", fb.puts)
	}
	if q := p.Queue("r1"); len(q) != 0 {
		t.Fatalf("left queued %v", q)
	}
}

// A turn that stops still runs what was queued behind it.
func TestStopDrainsTheQueue(t *testing.T) {
	p, fb := withBoxd(t)
	fb.hold["turn-1"], fb.logs["turn-1"] = make(chan int, 1), true
	p.Store.Put("sessions", "st1", contract.Session{ID: "st1", Env: "web", Actor: "wt-st1", State: "running",
		Forked: true, Turns: 1, Events: []contract.Event{{Kind: "prompt", Content: "long"}}})
	p.Store.Put("queue", "st1", []string{"after"})
	p.Recover()
	<-fb.waiting
	if err := p.Stop(context.Background(), "st1"); err != nil {
		t.Fatal(err)
	}
	s := rest(t, p, "st1", 2)
	if kinds(s) != "prompt,stopped,prompt" || fb.prompt("turn-2") != "after" {
		t.Fatalf("events %s, turn 2 %q", kinds(s), fb.prompt("turn-2"))
	}
	if _, ok := stops.Load(stopKey("st1", 1)); ok {
		t.Fatal("the stop outlived its turn")
	}
}

func TestStopKeptOnlyWhenCancelled(t *testing.T) {
	p, _ := withBoxd(t)
	p.Store.Put("sessions", "st2", contract.Session{ID: "st2", Env: "web", Actor: "wt-st2", State: "running", Turns: 5})
	if err := p.Stop(context.Background(), "st2"); err == nil {
		t.Fatal("stopping an ended run succeeded")
	}
	if _, ok := stops.Load(stopKey("st2", 5)); ok {
		t.Fatal("a failed stop was kept")
	}
}

// A stop left from an earlier turn does not end the next one.
func TestStaleStop(t *testing.T) {
	p, _ := withBoxd(t)
	p.Store.Put("sessions", "st3", contract.Session{ID: "st3", Env: "web", Actor: "wt-st3", State: "idle", Forked: true, Turns: 1})
	stops.Store(stopKey("st3", 2), true)
	if err := p.Say("st3", "go", ""); err != nil {
		t.Fatal(err)
	}
	if s := rest(t, p, "st3", 2); strings.Contains(kinds(s), "stopped") {
		t.Fatalf("events %s", kinds(s))
	}
}

func TestRecoverRunsPendingPrompt(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("sessions", "rc1", contract.Session{ID: "rc1", Env: "web", Actor: "wt-rc1", State: "running", Forked: true,
		Turns: 1, Pending: "dequeued", Events: []contract.Event{{Kind: "prompt", Content: "first"}}})
	p.Recover()
	rest(t, p, "rc1", 2)
	if fb.prompt("turn-2") != "dequeued" || fb.count("turn-1") != 0 {
		t.Fatalf("turn 2 %q, runs %v", fb.prompt("turn-2"), fb.puts)
	}
}

func TestRecoverFollowsRunningTurn(t *testing.T) {
	p, fb := withBoxd(t)
	fb.logs["turn-1"] = true
	p.Store.Put("sessions", "rc2", contract.Session{ID: "rc2", Env: "web", Actor: "wt-rc2", State: "running", Forked: true,
		Turns: 1, Events: []contract.Event{{Kind: "prompt", Content: "first"}, {Kind: "message", Content: "old"}}})
	p.Recover()
	s := rest(t, p, "rc2", 1)
	if fb.count("turn-1") != 0 || kinds(s) != "prompt" {
		t.Fatalf("runs %v, events %s", fb.puts, kinds(s))
	}
}

func TestRecoverSettlesDecidedApprovals(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("sessions", "rc3", contract.Session{ID: "rc3", Env: "web", Actor: "wt-rc3", State: "awaiting_approval",
		Forked: true, Turns: 1, Outcomes: []string{"set_title: done"}, Events: []contract.Event{{Kind: "prompt"}}})
	p.Store.Put("approvals", "x1", contract.Approval{ID: "x1", Session: "rc3", Turn: 1, Tool: "push_branch", State: "denied",
		Outcome: "push_branch: denied by the user"})
	p.Recover()
	rest(t, p, "rc3", 2)
	want := outcome + "\nset_title: done\npush_branch: denied by the user"
	if got := fb.prompt("turn-2"); got != want {
		t.Fatalf("outcome turn %q", got)
	}
}

func TestRecoverKeepsWaitingOnApprovals(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("sessions", "rc4", contract.Session{ID: "rc4", Env: "web", Actor: "wt-rc4", State: "awaiting_approval",
		Forked: true, Turns: 1, Events: []contract.Event{{Kind: "prompt"}}})
	p.Store.Put("approvals", "x2", contract.Approval{ID: "x2", Session: "rc4", Turn: 1, Tool: "push_branch", State: "pending"})
	p.Recover()
	time.Sleep(100 * time.Millisecond)
	if s := session(p, "rc4"); s.State != "awaiting_approval" || fb.total() != 0 {
		t.Fatalf("state %s, runs %v", s.State, fb.puts)
	}
}

func TestRecoverFinishesDecision(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("sessions", "rc6", contract.Session{ID: "rc6", Env: "web", Actor: "wt-rc6", State: "awaiting_approval",
		Forked: true, Turns: 1, Events: []contract.Event{{Kind: "prompt"}}})
	p.Store.Put("approvals", "x3", contract.Approval{ID: "x3", Session: "rc6", Turn: 1, Tool: "push_branch", State: "deciding"})
	p.Recover()
	rest(t, p, "rc6", 2)
	var a contract.Approval
	p.Store.Get("approvals", "x3", &a)
	if a.State != "denied" || fb.prompt("turn-2") != outcome+"\npush_branch: denied by the user" {
		t.Fatalf("approval %s, outcome turn %q", a.State, fb.prompt("turn-2"))
	}
}

func TestRecoverRunsQueueOfIdleSession(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("sessions", "rc5", contract.Session{ID: "rc5", Env: "web", Actor: "wt-rc5", State: "idle", Forked: true, Turns: 1})
	p.Store.Put("queue", "rc5", []string{"later"})
	p.Recover()
	rest(t, p, "rc5", 2)
	if fb.prompt("turn-2") != "later" {
		t.Fatalf("turn 2 %q", fb.prompt("turn-2"))
	}
}

// A session whose fork failed is forked again by the next message, and runs its first prompt before it.
func TestSayForksAgain(t *testing.T) {
	p, fb := withBoxd(t)
	p.Store.Put("ready", "web", contract.Seed{Env: "web", Template: "t", Tag: "t", State: "ready"})
	p.Store.Put("sessions", "f1", contract.Session{ID: "f1", Env: "web", Actor: "wt-f1", Branch: "hz/f1", State: "failed",
		Error: "boom", Pending: "first"})
	if err := p.Say("f1", "second", ""); err != nil {
		t.Fatal(err)
	}
	s := rest(t, p, "f1", 2)
	if !s.Forked || fb.count("branch") != 1 || fb.prompt("turn-1") != "first" || fb.prompt("turn-2") != "second" {
		t.Fatalf("forked %v, runs %v, prompts %q %q", s.Forked, fb.puts, fb.prompt("turn-1"), fb.prompt("turn-2"))
	}
	if c := p.Sandboxes.(*sandbox).created; len(c) != 1 || c[0] != "wt-f1" {
		t.Fatalf("created %v", c)
	}
}

func TestDecide(t *testing.T) {
	p, fb := withBoxd(t)
	h := p.Handler("api-dev.nvoi.to", "app-dev.nvoi.to", tokenSum)
	now := time.Now()
	p.Store.Put("sessions", "d1", contract.Session{ID: "d1", Env: "web", Actor: "wt-d1", State: "awaiting_approval",
		Forked: true, Turns: 1, Outcomes: []string{"set_title: done"},
		Events: []contract.Event{{Kind: "prompt", At: now.Add(-time.Minute)}}})
	p.Store.Put("approvals", "a1", contract.Approval{ID: "a1", Session: "d1", Turn: 1, Tool: "push_branch", State: "pending", At: now})
	p.Store.Put("approvals", "a2", contract.Approval{ID: "a2", Session: "d1", Turn: 1, Tool: "create_pull_request",
		State: "pending", At: now.Add(time.Millisecond)})
	// An approval from an earlier turn is neither waited on nor reported again.
	p.Store.Put("approvals", "a0", contract.Approval{ID: "a0", Session: "d1", Turn: 0, Tool: "push_branch", State: "done",
		Outcome: "push_branch: pushed", At: now.Add(-time.Hour)})

	if res := call(h, "POST", "api-dev.nvoi.to", "/approvals/a1/deny", "", bearer); res.Code != http.StatusAccepted {
		t.Fatalf("first click %d %s", res.Code, res.Body.String())
	}
	if res := call(h, "POST", "api-dev.nvoi.to", "/approvals/a1/deny", "", bearer); res.Code != http.StatusConflict {
		t.Fatalf("second click %d %s", res.Code, res.Body.String())
	}
	time.Sleep(50 * time.Millisecond)
	if s := session(p, "d1"); s.State != "awaiting_approval" {
		t.Fatalf("ran before every approval was decided: %s", s.State)
	}
	if _, err := p.Decide("a2", false, "ben"); err != nil {
		t.Fatal(err)
	}
	rest(t, p, "d1", 2)
	want := outcome + "\nset_title: done\npush_branch: denied by the user\ncreate_pull_request: denied by the user"
	if got := fb.prompt("turn-2"); got != want {
		t.Fatalf("outcome turn %q", got)
	}
	if s := session(p, "d1"); len(s.Outcomes) != 0 {
		t.Fatalf("outcomes kept %v", s.Outcomes)
	}
}

func TestDecideOnce(t *testing.T) {
	p, _ := handler(t)
	p.Store.Put("sessions", "d2", contract.Session{ID: "d2", State: "idle"})
	p.Store.Put("approvals", "b1", contract.Approval{ID: "b1", Session: "d2", Tool: "push_branch", State: "pending"})
	var wg sync.WaitGroup
	var mu sync.Mutex
	won, lost := 0, 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := p.Decide("b1", false, "ben")
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				won++
			} else if errors.As(err, new(conflict)) {
				lost++
			}
		}()
	}
	wg.Wait()
	if won != 1 || lost != 7 {
		t.Fatalf("won %d, lost %d", won, lost)
	}
}

type heldPin chan struct{}

func (h heldPin) pin(ctx context.Context, image string) (string, error) {
	<-h
	return "", errors.New("registry down")
}

func TestSeedOneAtATime(t *testing.T) {
	p, _ := withBoxd(t)
	h := p.Handler("api-dev.nvoi.to", "app-dev.nvoi.to", tokenSum)
	held := make(heldPin)
	p.Pin = held.pin
	if res := call(h, "POST", "api-dev.nvoi.to", "/environments/web/seed", "", bearer); res.Code != http.StatusAccepted {
		t.Fatalf("first %d", res.Code)
	}
	if res := call(h, "POST", "api-dev.nvoi.to", "/environments/web/seed", "", bearer); res.Code != http.StatusConflict {
		t.Fatalf("second %d", res.Code)
	}
	close(held)
	until(t, "the build to fail", func() bool {
		var s contract.Seed
		return p.Store.Get("seeds", "web", &s) == nil && s.State == "failed"
	})
	until(t, "the build to be released", func() bool {
		_, busy := seeding.Load("web")
		return !busy
	})
}

// A seed being built again leaves the last ready one in service.
func TestSeedServesLastReady(t *testing.T) {
	p, _ := withBoxd(t)
	h := p.Handler("api-dev.nvoi.to", "app-dev.nvoi.to", tokenSum)
	p.Store.Put("ready", "web", contract.Seed{Env: "web", Template: "old", Tag: "old", State: "ready"})
	p.Store.Put("seeds", "web", contract.Seed{Env: "web", State: "building"})
	res := call(h, "GET", "api-dev.nvoi.to", "/environments", "", bearer)
	if !strings.Contains(res.Body.String(), `"ready":true`) {
		t.Fatalf("environments %s", res.Body.String())
	}
	seed, err := p.served("web")
	if err != nil || seed.Tag != "old" {
		t.Fatalf("served %+v %v", seed, err)
	}
	p.Recover()
	var s contract.Seed
	if p.Store.Get("seeds", "web", &s); s.State != "failed" {
		t.Fatalf("an interrupted build is %s", s.State)
	}
	if _, err := p.served("web"); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshReseedsOtherContainers(t *testing.T) {
	p, _ := withBoxd(t)
	p.BoxImage = "boxd@new"
	var env contract.Environment
	p.Store.Get("environments", "web", &env)
	cs, err := p.containers(context.Background(), env)
	if err != nil {
		t.Fatal(err)
	}
	p.Store.Put("ready", "web", contract.Seed{Env: "web", State: "ready", Spec: spec(cs)})
	p.Refresh()
	time.Sleep(100 * time.Millisecond)
	var seed contract.Seed
	if p.Store.Get("seeds", "web", &seed) == nil {
		t.Fatalf("rebuilt a current seed: %+v", seed)
	}
	p.Store.Put("ready", "web", contract.Seed{Env: "web", State: "ready", Spec: "old"})
	p.Refresh()
	for i := 0; ; i++ {
		if p.Store.Get("seeds", "web", &seed) == nil && seed.Spec == spec(cs) {
			break
		}
		if i == 50 {
			t.Fatalf("no rebuild from the new containers: %+v", seed)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// A turn whose claude answered but stays up for a background shell is ended, and counts as a clean exit.
func TestAnsweredTurnEnds(t *testing.T) {
	p, fb := withBoxd(t)
	linger = 50 * time.Millisecond
	t.Cleanup(func() { linger = 10 * time.Second })
	fb.hold["turn-1"], fb.logs["turn-1"] = make(chan int, 1), true
	fb.lines["turn-1"] = `{"type":"result","result":"done"}` + "\n"
	p.Store.Put("sessions", "an1", contract.Session{ID: "an1", Env: "web", Actor: "wt-an1", State: "running",
		Forked: true, Turns: 1, Events: []contract.Event{{Kind: "prompt", Content: "serve"}}})
	p.Recover()
	s := rest(t, p, "an1", 1)
	if kinds(s) != "prompt,result" {
		t.Fatalf("events %s", kinds(s))
	}
}

// A turn that ended on a network error goes on after a pause; one that ended on anything else does not.
func TestTransientTurnRetried(t *testing.T) {
	retryPause = 10 * time.Millisecond
	t.Cleanup(func() { retryPause = 10 * time.Second })
	p, fb := withBoxd(t)
	for sid, text := range map[string]string{"tr1": "API Error: Can't reach the API server (EAI_AGAIN)", "tr2": "Error: the tests failed"} {
		fb.hold["turn-1"], fb.logs["turn-1"] = make(chan int, 1), true
		fb.hold["turn-1"] <- 1
		fb.lines["turn-1"] = `{"type":"result","is_error":true,"result":"` + text + `"}` + "\n"
		p.Store.Put("sessions", sid, contract.Session{ID: sid, Env: "web", Actor: "wt-" + sid, State: "running",
			Forked: true, Turns: 1, Events: []contract.Event{{Kind: "prompt", Content: "go"}}})
		p.Recover()
		if sid == "tr1" {
			rest(t, p, sid, 2)
			if fb.prompt("turn-2") != again {
				t.Fatalf("retry prompt %q", fb.prompt("turn-2"))
			}
			delete(fb.lines, "turn-1")
			delete(fb.argv, "turn-2")
			continue
		}
		s := rest(t, p, sid, 1)
		if fb.count("turn-2") != 0 && s.Turns != 1 {
			t.Fatalf("a failure of the agent's own was retried: %d turns", s.Turns)
		}
	}
}

var testLLM = contract.LLMConfig{Name: "Claude Code", Provider: "claude_code", Main: true, Values: map[string]string{"kind": "oauth", "token": "t"}}
