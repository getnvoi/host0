package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestToolSchemas(t *testing.T) {
	b, _ := json.Marshal(Spec())
	if strings.Contains(string(b), "null") {
		t.Fatalf("a schema carries null: %s", b)
	}
}

func TestDo(t *testing.T) {
	c := &Call{Title: "old"}
	if out := Do(context.Background(), c, "set_title", `{"title":"Fix cart"}`); out != "set_title: done" || c.Title != "Fix cart" {
		t.Fatalf("%q, title %q", out, c.Title)
	}
	if out := Do(context.Background(), c, "navigate_preview", `{"path":"cart"}`); !strings.Contains(out, "a path starting with /") {
		t.Fatal(out)
	}
	if out := Do(context.Background(), c, "rm_rf", `{}`); out != "rm_rf: unknown tool" {
		t.Fatal(out)
	}
	if Policy("set_title") != "auto" || Policy("push_branch") != "" {
		t.Fatal("policies")
	}
}
