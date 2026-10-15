package workspace

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
)

func TestSearch(t *testing.T) {
	p := newWorkspace(t, nil)
	now := time.Now()
	sessionRow(t, p, Session{ID: "s1", Env: "shop", State: "idle", Title: "Fix the cart", Last: now, Events: []llm.Event{
		{Kind: "prompt", Content: "the checkout pelican breaks on submit", At: now},
		{Kind: "message", Content: "pelican pelican pelican: the cart total is off", At: now},
	}})
	sessionRow(t, p, Session{ID: "s2", Env: "web", State: "idle", Last: now, Events: []llm.Event{
		{Kind: "prompt", Content: "a long prompt about many things, among them one pelican, and the header, footer, " +
			"menus, fonts, colours, spacing and the rest of the page", At: now},
	}})
	sessionRow(t, p, Session{ID: "s3", Env: "web", State: "idle", Last: now, Events: []llm.Event{
		{Kind: "prompt", Content: "nothing to see", At: now},
	}})
	queueRows(t, p, "s3", "then rename\n\nthe   walrus")

	hits, err := p.Search("pelican", SearchLimit)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 3 {
		t.Fatalf("pelican: %+v", hits)
	}
	if h := hits[0]; h.Session != "s1" || h.In != "event" || h.Kind != "message" || h.Position != 1 || h.Env != "shop" {
		t.Errorf("best hit %+v, want s1's message", h)
	}
	if h := hits[2]; h.Session != "s2" || h.Position != 0 || h.Kind != "prompt" {
		t.Errorf("worst hit %+v, want s2's long prompt", h)
	}
	if hits[0].At.IsZero() {
		t.Error("a hit with no time")
	}
	if !strings.Contains(hits[1].Snippet, "the checkout **pelican** breaks") {
		t.Errorf("snippet %q", hits[1].Snippet)
	}

	if hits, err := p.Search("pelican", 1); err != nil || len(hits) != 1 || hits[0].Session != "s1" {
		t.Errorf("limit 1: %+v %v", hits, err)
	}
	if hits, err := p.Search("cart", SearchLimit); err != nil || len(hits) != 2 || !has(hits, "title") {
		t.Errorf("cart, in a title and a message: %+v %v", hits, err)
	}
	if hits, err := p.Search("walrus", SearchLimit); err != nil || len(hits) != 1 || hits[0].In != "queued" ||
		hits[0].Session != "s3" || hits[0].Snippet != "then rename the **walrus**" {
		t.Errorf("walrus, queued: %+v %v", hits, err)
	}
	if hits, err := p.Search(`"checkout pelican"`, SearchLimit); err != nil || len(hits) != 1 || hits[0].Session != "s1" {
		t.Errorf("a phrase: %+v %v", hits, err)
	}
	if hits, err := p.Search("pelican header", SearchLimit); err != nil || len(hits) != 1 || hits[0].Session != "s2" {
		t.Errorf("every word: %+v %v", hits, err)
	}

	for _, q := range []string{`pelican"`, `"pelican`, `pelican*`, `-pelican`, `in:pelican`, `pelican AND`, `NOT pelican`,
		`(pelican`, `pelican^`, `pelican OR "`, `* pelican -`, `col:"x" NEAR(pelican)`} {
		if _, err := p.Search(q, SearchLimit); err != nil {
			t.Errorf("%s: %v", q, err)
		}
	}
	for _, q := range []string{"", "   ", `""`, `* - : ( )`} {
		if _, err := p.Search(q, SearchLimit); !errors.As(err, new(Invalid)) {
			t.Errorf("%q: %v, want Invalid", q, err)
		}
	}
	for _, n := range []int{0, -1, SearchMax + 1} {
		if _, err := p.Search("pelican", n); !errors.As(err, new(Invalid)) {
			t.Errorf("limit %d: %v, want Invalid", n, err)
		}
	}

	if err := p.DB.Where("public_id = ?", "s1").Delete(&db.Session{}).Error; err != nil {
		t.Fatal(err)
	}
	hits, err = p.Search("pelican", SearchLimit)
	if err != nil || len(hits) != 3 || !hits[0].Removed || hits[2].Removed {
		t.Errorf("after s1 is removed: %+v %v", hits, err)
	}
}

func has(hits []Hit, in string) bool {
	for _, h := range hits {
		if h.In == in {
			return true
		}
	}
	return false
}
