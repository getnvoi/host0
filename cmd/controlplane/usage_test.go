package main

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
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
	st.Put("sessions", "s1", workspace.Session{ID: "s1", Env: "web", Actor: "wt-s1", By: "ben"})
	st.Put("sessions", "s2", workspace.Session{ID: "s2", Env: "web", Actor: "wt-s2", By: "cli"})
	st.Put("sessions", "s3", workspace.Session{ID: "s3", Env: "web", Actor: "wt-broken"})
	st.Put("sessions", "s4", workspace.Session{ID: "s4", Env: "web", Actor: "wt-s4"})
	sb := &fakeSandboxes{
		states:  map[string]string{"wt-s1": "running", "wt-s2": "paused", "seed-web": "suspended", "wt-s4": "resuming"},
		workers: []sandbox.Worker{{Pool: "hz-large", Pod: "a"}, {Pool: "hz-large", Pod: "b"}, {Pod: "c"}},
	}
	p, _ := serve(st, brokenState{sb}, nil, nil)
	putEnv(t, p, workspace.Environment{Name: "web", Tier: "large"})
	seedRow(t, p, "web", db.Seed{Actor: "seed-web", State: "ready"})
	now := time.Date(2026, 9, 25, 23, 59, 0, 0, time.UTC)
	p.sample(context.Background(), now)
	p.sample(context.Background(), now)

	var rows []db.UsageHour
	if err := p.DB.Order("tier, session").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	hour := time.Date(2026, 9, 25, 23, 0, 0, 0, time.UTC)
	got := map[string]db.UsageHour{}
	for _, r := range rows {
		if !r.Hour.Equal(hour) {
			t.Errorf("%s/%s in hour %s", r.Tier, r.Session, r.Hour)
		}
		r.ID, r.Hour = 0, time.Time{}
		got[r.Tier+"/"+r.Session] = r
	}
	want := map[string]db.UsageHour{
		"large/s1":       {Tier: "large", Session: "s1", Env: "web", By: "ben", RunningS: 120},
		"large/s2":       {Tier: "large", Session: "s2", Env: "web", By: "cli", PausedS: 120},
		"large/seed:web": {Tier: "large", Session: "seed:web", Env: "web", SuspendedS: 120},
		"large/":         {Tier: "large", WorkerS: 240},
		"/":              {WorkerS: 120},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("usage hours\n%+v\nwant\n%+v", got, want)
	}
}

func usageStore(t *testing.T) data {
	st := newStore(t)
	day := func(d string, h int) time.Time {
		t, _ := time.Parse("2006-01-02", d)
		return t.Add(time.Duration(h) * time.Hour)
	}
	st.Put("sessions", "a", workspace.Session{ID: "a", Env: "web", By: "ben", At: day("2026-09-24", 9), Events: []llm.Event{
		{Kind: "result", At: day("2026-09-24", 10), Meta: json.RawMessage(`{"tokens":100}`)},
		{Kind: "prompt", At: day("2026-09-25", 1), Content: workspace.Outcome + "\nset_title: done\ncreate_pull_request: opened https://x/1"},
		{Kind: "prompt", At: day("2026-09-25", 2), Content: "create_pull_request: opened by hand"},
		{Kind: "error", At: day("2026-09-20", 1), Meta: json.RawMessage(`{"tokens":50}`)},
	}})
	st.Put("sessions", "b", workspace.Session{ID: "b", Env: "api", By: "ann", At: day("2026-09-25", 3), Events: []llm.Event{
		{Kind: "result", At: day("2026-09-25", 4), Meta: json.RawMessage(`{"tokens":7}`)},
	}})
	for _, u := range []db.UsageHour{
		{Hour: day("2026-09-24", 9), Tier: "medium", Session: "a", Env: "web", By: "ben", RunningS: 1200},
		{Hour: day("2026-09-24", 10), Tier: "medium", Session: "a", Env: "web", By: "ben", RunningS: 600},
		{Hour: day("2026-09-25", 3), Tier: "medium", Session: "b", Env: "api", By: "ann", RunningS: 600, PausedS: 60},
		{Hour: day("2026-09-25", 0), Tier: "medium", Session: "seed:web", Env: "web", RunningS: 300, SuspendedS: 180},
		{Hour: day("2026-09-01", 0), Tier: "medium", Session: "a", Env: "web", By: "ben", RunningS: 59940},
		{Hour: day("2026-09-25", 5), Tier: "medium", WorkerS: 1200},
		{Hour: day("2026-09-25", 6), Tier: "", WorkerS: 60},
	} {
		if err := st.DB.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
	}
	at := day("2026-09-24", 10)
	st.Put("approvals", "x", workspace.Approval{ID: "x", Session: "a", State: "done", At: at, Decided: at.Add(4 * time.Second)})
	st.Put("approvals", "y", workspace.Approval{ID: "y", Session: "b", State: "denied", At: at, Decided: at.Add(2 * time.Second)})
	st.Put("approvals", "z", workspace.Approval{ID: "z", Session: "a", State: "pending", At: at})
	st.DB.Create(&db.SignIn{Digest: "h", Kind: "browser", Label: "carol", ExpiresAt: day("2026-09-01", 0)})
	return st
}

func TestUsage(t *testing.T) {
	p, _ := serve(usageStore(t), nil, nil, nil)
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
	_, h := serve(usageStore(t), nil, nil, nil)
	res := call(h, "GET", "api-dev.nvoi.to", "/usage?days=365&by=ben", "", bearer)
	var u workspace.Usage
	if json.NewDecoder(res.Body).Decode(&u); res.Code != 200 || len(u.Days) != 365 {
		t.Fatalf("%d, %d days", res.Code, len(u.Days))
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/usage", "", bearer)
	if json.NewDecoder(res.Body).Decode(&u); len(u.Days) != 30 {
		t.Fatalf("default %d days", len(u.Days))
	}
	for _, q := range []string{"days=1000", "days=0", "days=x"} {
		if res := call(h, "GET", "api-dev.nvoi.to", "/usage?"+q, "", bearer); res.Code != 400 || !strings.Contains(detail(res), "days") {
			t.Errorf("%s: %d %s", q, res.Code, detail(res))
		}
	}
}
