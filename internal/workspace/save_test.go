package workspace

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/llm"
)

// Each write announces only the events the last one did not.
func TestSaveSendsNewEvents(t *testing.T) {
	p := newWorkspace(t, nil)
	env(t, p, Environment{Name: "web"})
	c := p.Bus.(*bus).tap(t)
	s := &Session{ID: "a", Env: "web", State: "running", Events: []llm.Event{{Kind: "prompt", Content: "hi"}}}
	p.save(s)
	s.Events = append(s.Events, llm.Event{Kind: "message", Content: "hello"})
	p.save(s)
	<-c
	if u := <-c; u.From != 1 || len(u.Events) != 1 || u.Events[0].Content != "hello" {
		t.Fatalf("second write sent %+v, want only the second event", u)
	}
}

func TestUpdateSendsFromZero(t *testing.T) {
	b, _ := json.Marshal(Update{Kind: "session", Events: []llm.Event{{Kind: "prompt"}}})
	if !strings.Contains(string(b), `"from":0`) {
		t.Fatalf("from 0 left out: %s", b)
	}
}

func TestNewSessionHasAnEventList(t *testing.T) {
	p := newWorkspace(t, nil)
	env(t, p, Environment{Name: "web"})
	s := &Session{ID: "n", Env: "web", State: "forking"}
	p.save(s)
	var got map[string]any
	b, _ := json.Marshal(s)
	json.Unmarshal(b, &got)
	if _, ok := got["events"].([]any); !ok {
		t.Fatalf("events is %v, want a list", got["events"])
	}
}

func TestSayWhileRunning(t *testing.T) {
	p := newWorkspace(t, nil)
	sessionRow(t, p, Session{ID: "s1", State: "running"})
	done := make(chan error, 1)
	go func() { done <- p.Say("s1", "next", "") }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Say blocked: the queue lock is taken twice")
	}
	if q, _ := p.Queue("s1"); len(q) != 1 || q[0] != "next" {
		t.Fatalf("queue: %v", q)
	}
}

// Every actor a row names, and none a failed build left.
func TestNamed(t *testing.T) {
	p := newWorkspace(t, nil)
	sessionRow(t, p, Session{ID: "s1", Actor: "wt-s1", State: "forking"})
	seedRow(t, p, Seed{Env: "shop", State: "ready", Actor: "shop-b30f1ae1ab"})
	seedRow(t, p, Seed{Env: "web", State: "building", Actor: "web-1111111111"})
	seedRow(t, p, Seed{Env: "shop", State: "failed", Actor: "shop-853d8ecc03"})
	got := p.Named()
	if len(got) != 3 || !got["wt-s1"] || !got["shop-b30f1ae1ab"] || !got["web-1111111111"] {
		t.Fatalf("named %v", got)
	}
}
