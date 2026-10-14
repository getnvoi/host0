package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/workspace"
)

type brokenState struct{ *fakeSandboxes }

func (b brokenState) State(ctx context.Context, a string) (string, error) {
	if a == "wt-broken" {
		return "", errors.New("gone")
	}
	return b.fakeSandboxes.State(ctx, a)
}

func TestSample(t *testing.T) {
	st := newStore(t)
	sb := &fakeSandboxes{
		states:  map[string]string{"wt-s1": "running", "wt-s2": "paused", "seed-web": "suspended", "wt-s4": "resuming"},
		workers: []sandbox.Worker{{Pool: "hz-large", Pod: "a"}, {Pool: "hz-large", Pod: "b"}, {Pod: "c"}},
	}
	p, _ := serve(st, brokenState{sb}, nil, nil)
	putEnv(t, p, workspace.Environment{Name: "web", Tier: "large"})
	seedRow(t, p, "web", db.Seed{Actor: "seed-web", State: "ready"})
	for _, s := range []workspace.Session{{ID: "s1", Env: "web", By: "ben"}, {ID: "s2", Env: "web", By: "cli"},
		{ID: "broken", Env: "web"}, {ID: "s4", Env: "web"}} {
		usageSession(t, p, s)
	}
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
	for _, s := range []string{"broken", "s4"} {
		if st.Get("usage", "2026-09-25/"+s, &u) == nil {
			t.Fatalf("%s recorded: %+v", s, u)
		}
	}
	var n nodes
	st.Get("nodes", "2026-09-25", &n)
	if !reflect.DeepEqual(n.Minutes, map[string]float64{"hz-large": 4, "worker": 2}) {
		t.Fatalf("nodes: %+v", n)
	}
}

// Writes s as a session's rows: who started it, and its events.
func usageSession(t *testing.T, p *plane, s workspace.Session) {
	t.Helper()
	r := db.Session{PublicID: s.ID, State: "idle", StartedAt: s.At}
	if s.By != "" {
		m := db.Member{AccountID: "local:" + s.By, Login: s.By, Role: "operator"}
		if err := p.DB.Where(db.Member{AccountID: m.AccountID}).FirstOrCreate(&m).Error; err != nil {
			t.Fatal(err)
		}
		r.MemberID = &m.ID
	}
	r = sessionRow(t, p, s.Env, r)
	for i, e := range s.Events {
		if err := p.DB.Create(&db.Event{SessionID: r.ID, Position: i, Kind: e.Kind, Content: e.Content, Meta: e.Meta, At: e.At}).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func usagePlane(t *testing.T) (*plane, http.Handler) {
	st := newStore(t)
	p, h := serve(st, nil, nil, nil)
	day := func(d string, h int) time.Time {
		t, _ := time.Parse("2006-01-02", d)
		return t.Add(time.Duration(h) * time.Hour)
	}
	usageSession(t, p, workspace.Session{ID: "a", Env: "web", By: "ben", At: day("2026-09-24", 9), Events: []llm.Event{
		{Kind: "result", At: day("2026-09-24", 10), Meta: json.RawMessage(`{"tokens":100}`)},
		{Kind: "prompt", At: day("2026-09-25", 1), Content: workspace.Outcome + "\nset_title: done\ncreate_pull_request: opened https://x/1"},
		{Kind: "prompt", At: day("2026-09-25", 2), Content: "create_pull_request: opened by hand"},
		{Kind: "error", At: day("2026-09-20", 1), Meta: json.RawMessage(`{"tokens":50}`)},
	}})
	usageSession(t, p, workspace.Session{ID: "b", Env: "api", By: "ann", At: day("2026-09-25", 3), Events: []llm.Event{
		{Kind: "result", At: day("2026-09-25", 4), Meta: json.RawMessage(`{"tokens":7}`)},
	}})
	st.Put("usage", "2026-09-24/a", usage{Day: "2026-09-24", Session: "a", Env: "web", By: "ben", Running: 30})
	st.Put("usage", "2026-09-25/b", usage{Day: "2026-09-25", Session: "b", Env: "api", By: "ann", Running: 10, Paused: 1})
	st.Put("usage", "2026-09-25/seed:web", usage{Day: "2026-09-25", Session: "seed:web", Env: "web", Running: 5, Suspended: 3})
	st.Put("usage", "2026-09-01/a", usage{Day: "2026-09-01", Session: "a", Env: "web", By: "ben", Running: 999})
	st.Put("nodes", "2026-09-25", nodes{Day: "2026-09-25", Minutes: map[string]float64{"hz-medium": 20, "worker": 1}})
	at := day("2026-09-24", 10)
	st.Put("approvals", "x", workspace.Approval{ID: "x", Session: "a", State: "done", At: at, Decided: at.Add(4 * time.Second)})
	st.Put("approvals", "y", workspace.Approval{ID: "y", Session: "b", State: "denied", At: at, Decided: at.Add(2 * time.Second)})
	st.Put("approvals", "z", workspace.Approval{ID: "z", Session: "a", State: "pending", At: at})
	st.Put("browsers", "h", map[string]string{"label": "carol"})
	return p, h
}

func TestUsage(t *testing.T) {
	p, _ := usagePlane(t)
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
	want := workspace.UsageTotal{Sessions: 2, Compute: 45, PullRequests: 1, Tokens: 107, Approvals: 2, ApprovalWaitMS: 3000}
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
	if len(all.Environments) != 2 || all.Environments[0] != (workspace.UsageEnv{Name: "web", Compute: 35, Sessions: 1,
		PullRequests: 1, Tokens: 100}) || all.Environments[1].Name != "api" {
		t.Fatalf("environments %+v", all.Environments)
	}

	ben, _ := p.Usage(now, 3, "ben")
	want = workspace.UsageTotal{Sessions: 1, Compute: 30, PullRequests: 1, Tokens: 100, Approvals: 1, ApprovalWaitMS: 4000}
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
	_, h := usagePlane(t)
	res := call(h, "GET", "api-dev.nvoi.to", "/usage?days=1000", "", map[string]string{"Authorization": "Bearer cli-token"})
	var u workspace.Usage
	if json.NewDecoder(res.Body).Decode(&u); res.Code != 200 || len(u.Days) != 365 {
		t.Fatalf("%d, %d days", res.Code, len(u.Days))
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/usage", "", map[string]string{"Authorization": "Bearer cli-token"})
	if json.NewDecoder(res.Body).Decode(&u); len(u.Days) != 30 {
		t.Fatalf("default %d days", len(u.Days))
	}
}
