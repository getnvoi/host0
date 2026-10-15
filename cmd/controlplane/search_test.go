package main

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/workspace"
)

// GET /search answers the hits; a query with no word is refused 400, and an agent searches as a tool.
func TestSearch(t *testing.T) {
	p, h := handler(t)
	s := sessionRow(t, p, "web", db.Session{PublicID: "s1", State: "idle", Title: "Fix the cart"})
	for i, c := range []string{"the marmot in the checkout", "done with the marmot"} {
		if err := p.DB.Create(&db.Event{SessionID: s.ID, Position: i, Kind: "message", Content: c, At: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	res := call(h, "GET", "api-dev.nvoi.to", "/search?q="+url.QueryEscape(`marmot "in the checkout"`), "", bearer)
	var hits []workspace.Hit
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &hits) != nil || len(hits) != 1 || hits[0].Session != "s1" ||
		hits[0].Env != "web" || hits[0].Snippet != "the **marmot** **in the checkout**" {
		t.Fatalf("%d %s", res.Code, res.Body)
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/search?limit=1&q=marmot", "", bearer)
	if json.Unmarshal(res.Body.Bytes(), &hits) != nil || len(hits) != 1 {
		t.Fatalf("limit 1: %d %s", res.Code, res.Body)
	}
	for target, want := range map[string]string{
		"/search?q=" + url.QueryEscape(`"*" -`): "a search needs a word",
		"/search":                               "q",
		"/search?q=marmot&limit=101":            "limit",
	} {
		if res := call(h, "GET", "api-dev.nvoi.to", target, "", bearer); res.Code != 400 || !strings.Contains(detail(res), want) {
			t.Errorf("%s: %d %s", target, res.Code, detail(res))
		}
	}
	tools := map[string]workspace.Tool{}
	for _, tl := range p.tools.List() {
		tools[tl.Name] = tl
	}
	if tools["search"].Default != "auto" {
		t.Errorf("search is granted at %q by default", tools["search"].Default)
	}
	if got := p.tools.Call(context.Background(), "s1", "h0", "search", `{"q":"cart"}`); !strings.HasPrefix(got,
		`search: [{"session":"s1","env":"web","in":"title","position":0,"snippet":"Fix the **cart**"`) {
		t.Fatal(got)
	}
}
