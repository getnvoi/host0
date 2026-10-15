package main

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

// Every operation is a tool, with its default level.
func TestToolsFromOperations(t *testing.T) {
	p, _ := handler(t)
	tools := map[string]workspace.Tool{}
	for _, tl := range p.tools.List() {
		tools[tl.Name] = tl
	}
	n := 0
	for _, item := range (&plane{}).API(http.NewServeMux()).OpenAPI().Paths {
		for _, op := range []*huma.Operation{item.Get, item.Post, item.Put, item.Patch, item.Delete} {
			if op == nil {
				continue
			}
			n++
			if _, ok := tools[toolName(op.OperationID)]; !ok {
				t.Errorf("%s is no tool", op.OperationID)
			}
		}
	}
	if len(tools) != n {
		t.Fatalf("%d tools for %d operations", len(tools), n)
	}
	for name, want := range map[string]string{"env_ls": "auto", "env_put": "approval", "session_title": "auto",
		"session_navigate": "auto", "session_push": "approval", "session_pr": "approval", "approval_approve": "deny",
		"agent_tool_set": "deny", "agent_put": "deny", "stream": "deny", "invite": "deny"} {
		if got := tools[name].Default; got != want {
			t.Errorf("%s: %s, want %s", name, got, want)
		}
	}
	schema := func(name string) (map[string]any, []string) {
		var s struct {
			Properties map[string]any `json:"properties"`
			Required   []string       `json:"required"`
		}
		b, _ := json.Marshal(tools[name].Schema)
		json.Unmarshal(b, &s)
		return s.Properties, s.Required
	}
	if props, req := schema("session_title"); props["id"] == nil || props["title"] == nil || !slices.Equal(req, []string{"id", "title"}) {
		t.Fatalf("session_title: %v %v", props, req)
	}
	// The environment's own name field would clash with the path's: its body travels whole.
	if props, req := schema("env_put"); props["name"] == nil || props["body"] == nil || !slices.Contains(req, "body") {
		t.Fatalf("env_put: %v %v", props, req)
	}
	// Every tool is given to an agent in one environment variable, which Linux caps at 128 KiB.
	b, _ := json.Marshal(p.tools.List())
	if spec, _ := json.Marshal(tools); len(spec) > 96<<10 || strings.Contains(string(b), `"$ref"`) {
		t.Fatalf("tools spec: %d bytes, refs %v", len(spec), strings.Contains(string(b), `"$ref"`))
	}
}

// A call is the operation, served in-process as the agent.
func TestToolCall(t *testing.T) {
	p, _ := handler(t)
	putEnv(t, p, workspace.Environment{Name: "web", Repo: "o/r", Branch: "main"})
	ctx := context.Background()
	for _, c := range []struct{ name, input, want string }{
		{"env_get", `{"name":"web"}`, `env_get: {"name":"web","repo":"o/r","branch":"main"`},
		{"env_ls", ``, `env_ls: [{"name":"web"`},
		{"env_get", `{}`, `env_get: failed: name is required`},
		{"env_get", `{"name":"nope"}`, `env_get: failed: no environment nope`},
		{"session_title", `{"id":"nope","title":"x"}`, `session_title: failed: no session nope`},
		{"session_navigate", `{"id":"nope","path":"/"}`, `session_navigate: failed: no session nope`},
		{"env_get", `[1]`, `env_get: failed: its input is not a JSON object`},
		{"rm_rf", `{}`, `rm_rf: failed: no such tool`},
		{"env_set", `{"name":"web","image":"ruby:3"}`, `env_set: {"name":"web","repo":"o/r","branch":"main","image":"ruby:3"`},
	} {
		if got := p.tools.Call(ctx, "s1", "hz", c.name, c.input); !strings.HasPrefix(got, c.want) {
			t.Errorf("%s %s:\n got %s\nwant %s", c.name, c.input, got, c.want)
		}
	}
	// An operation only the CLI's token reaches refuses an agent.
	if got := p.tools.Call(ctx, "s1", "hz", "invite", `{"label":"x"}`); !strings.HasPrefix(got, "invite: failed:") {
		t.Fatal(got)
	}
}
