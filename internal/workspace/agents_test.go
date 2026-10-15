package workspace

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/llm"
)

// An agent has the tools it is granted and no other.
func TestGrants(t *testing.T) {
	p := newWorkspace(t, nil)
	level := func(tool string) string {
		t.Helper()
		l, err := p.level(agentName, tool)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	if level("session_title") != "" || level("rm_rf") != "" {
		t.Fatal("a tool nobody granted")
	}
	a, err := p.Grant(agentName, "session_push", "auto")
	if err != nil || level("session_push") != "auto" || len(a.Tools) != 1 || grant(a, "session_push").Level != "auto" {
		t.Fatalf("grant %+v %v", a, err)
	}
	given, err := p.given(agentName)
	if err != nil || len(given) != 1 || given[0]["name"] != "session_push" {
		t.Fatalf("given %v %v", given, err)
	}
	if a, err = p.Revoke(agentName, "session_push"); err != nil || level("session_push") != "" || len(a.Tools) != 0 {
		t.Fatalf("revoke %+v %v", a, err)
	}
	if _, err := p.Grant(agentName, "session_push", "deny"); !errors.As(err, new(Invalid)) {
		t.Fatalf("deny is no level: %v", err)
	}
	if _, err := p.Grant(agentName, "rm_rf", "auto"); !errors.As(err, new(NotFound)) {
		t.Fatalf("no tool: %v", err)
	}
	if _, err := p.Grant("other", "session_push", "auto"); !errors.As(err, new(NotFound)) {
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

// A turn's calls go by its agent's grants: auto at once, approval parked, a tool it lacks unknown.
func TestTurnFollowsLevels(t *testing.T) {
	p, fb := withBoxd(t)
	if _, err := p.PutAgent(agentName, AgentInput{Tools: map[string]string{"session_title": "auto", "session_pr": "approval"}}); err != nil {
		t.Fatal(err)
	}
	use := func(id, name string) string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__h0__` + name + `","id":"` + id +
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
	want := []string{"session_title: done", "session_push: no such tool", "rm_rf: no such tool"}
	if s.State != "awaiting_approval" || len(s.Outcomes) != 3 || s.Outcomes[0] != want[0] || s.Outcomes[1] != want[1] ||
		s.Outcomes[2] != want[2] {
		t.Fatalf("%s %q", s.State, s.Outcomes)
	}
	asks, err := p.Approvals("lv1", "pending")
	if err != nil || len(asks) != 1 || asks[0].Tool != "session_pr" {
		t.Fatalf("approvals %+v %v", asks, err)
	}
}

// "*" grants every tool and a tool named beside it overrides it; declaring the same agent again changes nothing.
func TestPutAgent(t *testing.T) {
	p := newWorkspace(t, nil)
	in := AgentInput{Description: "all", Model: "opus", Instructions: "Be brief.",
		Tools: map[string]string{"*": "auto", "session_pr": "approval"}}
	a, err := p.PutAgent("ops", in)
	if err != nil {
		t.Fatal(err)
	}
	if a.Model != "opus" || grant(a, "session_push").Level != "auto" || grant(a, "session_pr").Level != "approval" ||
		grant(a, "session_title").Level != "auto" {
		t.Fatalf("put %+v", a)
	}
	again, err := p.PutAgent("ops", in)
	if err != nil || !reflect.DeepEqual(a, again) {
		t.Fatalf("again %+v %v", again, err)
	}
	// Tools the file no longer grants go.
	a, err = p.PutAgent("ops", AgentInput{Description: "none"})
	if err != nil || len(a.Tools) != 0 {
		t.Fatalf("emptied %+v %v", a, err)
	}
	// A list grants only what it names; default is each tool's own level.
	a, err = p.PutAgent("ops", AgentInput{Tools: map[string]string{"session_title": "auto"}})
	if err != nil || len(a.Tools) != 1 || grant(a, "session_title").Level != "auto" {
		t.Fatalf("listed %+v %v", a, err)
	}
	a, err = p.PutAgent("ops", AgentInput{Tools: map[string]string{"*": "default"}})
	if err != nil || grant(a, "session_title").Level != "auto" || grant(a, "session_push").Level != "approval" {
		t.Fatalf("defaults %+v %v", a, err)
	}
	for _, bad := range []struct {
		name string
		in   AgentInput
	}{{"Ops", AgentInput{}}, {"ops", AgentInput{Tools: map[string]string{"*": "maybe"}}},
		{"ops", AgentInput{Tools: map[string]string{"session_push": "deny"}}},
		{"ops", AgentInput{Tools: map[string]string{"rm_rf": "auto"}}}} {
		if _, err := p.PutAgent(bad.name, bad.in); !errors.As(err, new(Invalid)) {
			t.Errorf("%s %+v: %v", bad.name, bad.in, err)
		}
	}
	if err := p.RemoveAgent("ops"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Agent("ops"); !errors.As(err, new(NotFound)) {
		t.Fatalf("removed agent: %v", err)
	}
	if err := p.RemoveAgent(agentName); !errors.As(err, new(Invalid)) {
		t.Fatalf("removed the workspace's own agent: %v", err)
	}
	if _, err := p.Start("web", "nobody", "hi", "cli"); !errors.As(err, new(NotFound)) {
		t.Fatalf("start as no agent: %v", err)
	}
}
