package workspace

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/llm"
)

func TestRules(t *testing.T) {
	p := newWorkspace(t, nil)
	level := func(tool string) string {
		t.Helper()
		l, err := p.level(agentName, tool)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	if level("session_title") != "auto" || level("session_push") != "approval" || level("rm_rf") != "deny" {
		t.Fatal("defaults")
	}
	a, err := p.SetRule(agentName, "session_push", "deny")
	if err != nil || level("session_push") != "deny" {
		t.Fatalf("set: %v", err)
	}
	if g := grant(a, "session_push"); !g.Rule || g.Level != "deny" {
		t.Fatalf("grant %+v", g)
	}
	given, err := p.given(agentName)
	if err != nil || len(given) != 3 {
		t.Fatalf("given %v %v", given, err)
	}
	for _, g := range given {
		if g["name"] == "session_push" {
			t.Fatal("a denied tool is given")
		}
	}
	if a, err = p.DropRule(agentName, "session_push"); err != nil || level("session_push") != "approval" || grant(a, "session_push").Rule {
		t.Fatalf("drop: %v", err)
	}
	if _, err := p.SetRule(agentName, "session_push", "maybe"); !errors.As(err, new(Invalid)) {
		t.Fatalf("bad level: %v", err)
	}
	if _, err := p.SetRule(agentName, "rm_rf", "auto"); !errors.As(err, new(NotFound)) {
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
	if _, err := p.SetRule(agentName, "session_push", "deny"); err != nil {
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

// An agent file's "*" covers every tool, a tool named beside it overrides it, and declaring it again changes nothing.
func TestPutAgent(t *testing.T) {
	p := newWorkspace(t, nil)
	in := AgentInput{Description: "all", Model: "opus", Instructions: "Be brief.",
		Tools: map[string]string{"*": "auto", "session_pr": "approval"}}
	a, err := p.PutAgent("ops", in)
	if err != nil {
		t.Fatal(err)
	}
	if a.Model != "opus" || grant(a, "session_push").Level != "auto" || grant(a, "session_pr").Level != "approval" ||
		!grant(a, "session_title").Rule {
		t.Fatalf("put %+v", a)
	}
	again, err := p.PutAgent("ops", in)
	if err != nil || !reflect.DeepEqual(a, again) {
		t.Fatalf("again %+v %v", again, err)
	}
	// Rules the file no longer names go: the tool's default applies.
	a, err = p.PutAgent("ops", AgentInput{Description: "none"})
	if err != nil || grant(a, "session_push").Level != "approval" || grant(a, "session_push").Rule {
		t.Fatalf("emptied %+v %v", a, err)
	}
	for _, bad := range []struct {
		name string
		in   AgentInput
	}{{"Ops", AgentInput{}}, {"ops", AgentInput{Tools: map[string]string{"*": "maybe"}}},
		{"ops", AgentInput{Tools: map[string]string{"rm_rf": "auto"}}}} {
		if _, err := p.PutAgent(bad.name, bad.in); !errors.As(err, new(Invalid)) {
			t.Errorf("%s %+v: %v", bad.name, bad.in, err)
		}
	}
	if _, err := p.Start("web", "nobody", "hi", "cli"); !errors.As(err, new(NotFound)) {
		t.Fatalf("start as no agent: %v", err)
	}
}
