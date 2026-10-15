package workspace

import (
	"errors"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/llm"
)

func TestRules(t *testing.T) {
	p := newWorkspace(t, nil)
	level := func(tool string) string {
		t.Helper()
		l, err := p.level(agentSlug, tool)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	if level("session_title") != "auto" || level("session_push") != "approval" || level("rm_rf") != "deny" {
		t.Fatal("defaults")
	}
	a, err := p.SetRule(agentSlug, "session_push", "deny")
	if err != nil || level("session_push") != "deny" {
		t.Fatalf("set: %v", err)
	}
	if g := grant(a, "session_push"); !g.Rule || g.Level != "deny" {
		t.Fatalf("grant %+v", g)
	}
	given, err := p.given(agentSlug)
	if err != nil || len(given) != 3 {
		t.Fatalf("given %v %v", given, err)
	}
	for _, g := range given {
		if g["name"] == "session_push" {
			t.Fatal("a denied tool is given")
		}
	}
	if a, err = p.DropRule(agentSlug, "session_push"); err != nil || level("session_push") != "approval" || grant(a, "session_push").Rule {
		t.Fatalf("drop: %v", err)
	}
	if _, err := p.SetRule(agentSlug, "session_push", "maybe"); !errors.As(err, new(Invalid)) {
		t.Fatalf("bad level: %v", err)
	}
	if _, err := p.SetRule(agentSlug, "rm_rf", "auto"); !errors.As(err, new(NotFound)) {
		t.Fatalf("no tool: %v", err)
	}
	if _, err := p.SetRule("other", "session_push", "auto"); !errors.As(err, new(NotFound)) {
		t.Fatalf("no agent: %v", err)
	}
}

func grant(a Agent, tool string) Grant {
	for _, g := range a.Tools {
		if g.Tool == tool {
			return g
		}
	}
	return Grant{}
}

// A turn's calls go by its agent's levels: auto at once, approval parked, deny refused.
func TestTurnFollowsLevels(t *testing.T) {
	p, fb := withBoxd(t)
	if _, err := p.SetRule(agentSlug, "session_push", "deny"); err != nil {
		t.Fatal(err)
	}
	use := func(id, name string) string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__hz__` + name + `","id":"` + id +
			`","input":{"id":"lv1"}}]}}` + "\n"
	}
	fb.logs["turn-1"] = true
	fb.lines["turn-1"] = use("t1", "session_title") + use("t2", "session_push") + use("t3", "session_pr") +
		use("t4", "rm_rf") + `{"type":"result","result":"done"}` + "\n"
	sessionRow(t, p, Session{ID: "lv1", Env: "web", Actor: "wt-lv1", State: "running",
		Forked: true, Turns: 1, Events: []llm.Event{{Kind: "prompt", Content: "go"}}})
	p.Recover()
	var s Session
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if s, _ = p.load("lv1"); s.State == "awaiting_approval" {
			break
		}
	}
	want := []string{"session_title: done", "session_push: refused by policy", "rm_rf: refused by policy"}
	if s.State != "awaiting_approval" || len(s.Outcomes) != 3 || s.Outcomes[0] != want[0] || s.Outcomes[1] != want[1] ||
		s.Outcomes[2] != want[2] {
		t.Fatalf("%s %q", s.State, s.Outcomes)
	}
	asks, err := p.Approvals("lv1", "pending")
	if err != nil || len(asks) != 1 || asks[0].Tool != "session_pr" {
		t.Fatalf("approvals %+v %v", asks, err)
	}
}
