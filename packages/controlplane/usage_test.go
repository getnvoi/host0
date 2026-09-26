package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/getnvoi/nvoi/shared/contract"
)

type brokenState struct{ *fakeSandboxes }

func (b brokenState) State(ctx context.Context, a string) (string, error) {
	if a == "wt-broken" {
		return "", errors.New("gone")
	}
	return b.fakeSandboxes.State(ctx, a)
}

func TestSample(t *testing.T) {
	st := newStore()
	st.Put("environments", "web", contract.Environment{Name: "web", Tier: "large"})
	st.Put("sessions", "s1", contract.Session{ID: "s1", Env: "web", Actor: "wt-s1", By: "ben"})
	st.Put("sessions", "s2", contract.Session{ID: "s2", Env: "web", Actor: "wt-s2", By: "cli"})
	st.Put("sessions", "s3", contract.Session{ID: "s3", Env: "web", Actor: "wt-broken"})
	st.Put("sessions", "s4", contract.Session{ID: "s4", Env: "web", Actor: "wt-s4"})
	st.Put("seeds", "web", contract.Seed{Env: "web", Actor: "seed-web"})
	sb := &fakeSandboxes{
		states:  map[string]string{"wt-s1": "running", "wt-s2": "paused", "seed-web": "suspended", "wt-s4": "resuming"},
		workers: []Worker{{Pool: "nvoi-large", Pod: "a"}, {Pool: "nvoi-large", Pod: "b"}, {Pod: "c"}},
	}
	p := &Plane{Store: st, Sandboxes: brokenState{sb}}
	now := time.Date(2026, 9, 25, 23, 59, 0, 0, time.UTC)
	p.sample(context.Background(), now)
	p.sample(context.Background(), now)

	var u usage
	if err := st.Get("usage", "2026-09-25/s1", &u); err != nil || u != (usage{Day: "2026-09-25", Session: "s1", Env: "web",
		Tier: "large", By: "ben", Running: 2}) {
		t.Fatalf("s1: %+v %v", u, err)
	}
	if st.Get("usage", "2026-09-25/s2", &u); u.Paused != 2 || u.Running != 0 {
		t.Fatalf("s2: %+v", u)
	}
	if st.Get("usage", "2026-09-25/seed:web", &u); u.Suspended != 2 || u.By != "" || u.Session != "seed:web" {
		t.Fatalf("seed: %+v", u)
	}
	for _, s := range []string{"s3", "s4"} {
		if st.Get("usage", "2026-09-25/"+s, &u) == nil {
			t.Fatalf("%s recorded: %+v", s, u)
		}
	}
	var n nodes
	st.Get("nodes", "2026-09-25", &n)
	if !reflect.DeepEqual(n.Minutes, map[string]float64{"nvoi-large": 4, "worker": 2}) {
		t.Fatalf("nodes: %+v", n)
	}
}

func usageStore() *fakeStore {
	st := newStore()
	day := func(d string, h int) time.Time {
		t, _ := time.Parse("2006-01-02", d)
		return t.Add(time.Duration(h) * time.Hour)
	}
	st.Put("sessions", "a", contract.Session{ID: "a", Env: "web", By: "ben", At: day("2026-09-24", 9), Events: []contract.Event{
		{Kind: "result", At: day("2026-09-24", 10), Meta: json.RawMessage(`{"tokens":100}`)},
		{Kind: "prompt", At: day("2026-09-25", 1), Content: outcome + "\nset_title: done\ncreate_pull_request: opened https://x/1"},
		{Kind: "prompt", At: day("2026-09-25", 2), Content: "create_pull_request: opened by hand"},
		{Kind: "error", At: day("2026-09-20", 1), Meta: json.RawMessage(`{"tokens":50}`)},
	}})
	st.Put("sessions", "b", contract.Session{ID: "b", Env: "api", By: "ann", At: day("2026-09-25", 3), Events: []contract.Event{
		{Kind: "result", At: day("2026-09-25", 4), Meta: json.RawMessage(`{"tokens":7}`)},
	}})
	st.Put("usage", "2026-09-24/a", usage{Day: "2026-09-24", Session: "a", Env: "web", By: "ben", Running: 30})
	st.Put("usage", "2026-09-25/b", usage{Day: "2026-09-25", Session: "b", Env: "api", By: "ann", Running: 10, Paused: 1})
	st.Put("usage", "2026-09-25/seed:web", usage{Day: "2026-09-25", Session: "seed:web", Env: "web", Running: 5, Suspended: 3})
	st.Put("usage", "2026-09-01/a", usage{Day: "2026-09-01", Session: "a", Env: "web", By: "ben", Running: 999})
	st.Put("nodes", "2026-09-25", nodes{Day: "2026-09-25", Minutes: map[string]float64{"nvoi-medium": 20, "worker": 1}})
	at := day("2026-09-24", 10)
	st.Put("approvals", "x", contract.Approval{ID: "x", Session: "a", State: "done", At: at, Decided: at.Add(4 * time.Second)})
	st.Put("approvals", "y", contract.Approval{ID: "y", Session: "b", State: "denied", At: at, Decided: at.Add(2 * time.Second)})
	st.Put("approvals", "z", contract.Approval{ID: "z", Session: "a", State: "pending", At: at})
	st.Put("browsers", "h", browser{Label: "carol"})
	return st
}

func TestUsage(t *testing.T) {
	p := &Plane{Store: usageStore()}
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

	all, err := p.Usage(now, 3, "")
	if err != nil {
		t.Fatal(err)
	}
	if all.From != "2026-09-23" || all.To != "2026-09-25" || len(all.Days) != 3 {
		t.Fatalf("range %s..%s, %d days", all.From, all.To, len(all.Days))
	}
	if !reflect.DeepEqual(all.People, []string{"ann", "ben", "carol"}) {
		t.Fatalf("people %v", all.People)
	}
	want := contract.UsageTotal{Sessions: 2, Compute: 45, PullRequests: 1, Tokens: 107, Approvals: 2, ApprovalWaitMS: 3000}
	if all.Totals != want {
		t.Fatalf("totals %+v", all.Totals)
	}
	if d := all.Days[0]; d.Day != "2026-09-23" || len(d.Compute) != 0 || len(d.States) != 3 || d.Sessions != 0 {
		t.Fatalf("empty day %+v", d)
	}
	if d := all.Days[2]; d.Nodes != 21 || d.Compute["web"] != 5 || d.Compute["api"] != 10 || d.States["suspended"] != 3 ||
		d.PullRequests != 1 || d.Tokens != 7 || d.Sessions != 1 {
		t.Fatalf("today %+v", d)
	}
	if len(all.Environments) != 2 || all.Environments[0] != (contract.UsageEnv{Name: "web", Compute: 35, Sessions: 1,
		PullRequests: 1, Tokens: 100}) || all.Environments[1].Name != "api" {
		t.Fatalf("environments %+v", all.Environments)
	}

	ben, _ := p.Usage(now, 3, "ben")
	want = contract.UsageTotal{Sessions: 1, Compute: 30, PullRequests: 1, Tokens: 100, Approvals: 1, ApprovalWaitMS: 4000}
	if ben.Totals != want {
		t.Fatalf("ben totals %+v", ben.Totals)
	}
	if d := ben.Days[2]; d.Nodes != 0 || len(d.Compute) != 0 || d.Tokens != 0 {
		t.Fatalf("ben today %+v", d)
	}
	if len(ben.Environments) != 1 || len(ben.People) != 3 {
		t.Fatalf("ben %+v", ben)
	}
}

func TestUsageRoute(t *testing.T) {
	p, h := handler(t)
	p.Store = usageStore()
	res := call(h, "GET", "api-dev.nvoi.to", "/usage?days=1000", "", map[string]string{"Authorization": "Bearer cli-token"})
	var u contract.Usage
	if json.NewDecoder(res.Body).Decode(&u); res.Code != 200 || len(u.Days) != 365 {
		t.Fatalf("%d, %d days", res.Code, len(u.Days))
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/usage", "", map[string]string{"Authorization": "Bearer cli-token"})
	if json.NewDecoder(res.Body).Decode(&u); len(u.Days) != 30 {
		t.Fatalf("default %d days", len(u.Days))
	}
}

func TestWho(t *testing.T) {
	p := &Plane{Store: newStore()}
	p.Store.Put("browsers", digest("t"), browser{Label: "ben", Until: time.Now().Add(time.Hour)})
	var got string
	h := p.signedIn(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = who(r.Context()) }))
	r := httptest.NewRequest("GET", "/usage", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: "t"})
	h.ServeHTTP(httptest.NewRecorder(), r)
	if got != "ben" {
		t.Fatalf("who %q", got)
	}
}
