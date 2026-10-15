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

// Every operation an agent could hold is a tool, with the level default grants it at; the others are none.
func TestToolsFromOperations(t *testing.T) {
	p, _ := handler(t)
	tools := map[string]workspace.Tool{}
	for _, tl := range p.tools.List() {
		tools[tl.Name] = tl
	}
	for _, item := range (&plane{}).API(http.NewServeMux()).OpenAPI().Paths {
		for _, op := range []*huma.Operation{item.Get, item.Post, item.Put, item.Patch, item.Delete} {
			if op == nil {
				continue
			}
			if _, ok := tools[toolName(op.OperationID)]; ok != isTool(op) {
				t.Errorf("%s: a tool %v, should be %v", op.OperationID, ok, isTool(op))
			}
		}
	}
	for name, want := range map[string]string{"env_ls": "auto", "env_put": "approval", "session_title": "auto",
		"session_navigate": "auto", "session_push": "approval", "session_pr": "approval"} {
		if got := tools[name].Default; got != want {
			t.Errorf("%s: %s, want %s", name, got, want)
		}
	}
	for _, name := range []string{"approval_approve", "approval_deny", "agent_put", "agent_tool_set", "agent_tool_rm",
		"stream", "invite"} {
		if _, ok := tools[name]; ok {
			t.Errorf("%s is a tool", name)
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
		if got := p.tools.Call(ctx, "s1", "h0", c.name, c.input); !strings.HasPrefix(got, c.want) {
			t.Errorf("%s %s:\n got %s\nwant %s", c.name, c.input, got, c.want)
		}
	}
	// An operation only the CLI's token reaches refuses an agent.
	if got := p.tools.Call(ctx, "s1", "h0", "invite", `{"label":"x"}`); !strings.HasPrefix(got, "invite: failed:") {
		t.Fatal(got)
	}
}

// An agent's level for a tool is its grant and nothing else; an operation that is not a tool cannot be granted.
func TestGrantIsTheLevel(t *testing.T) {
	p, _ := handler(t)
	a, err := p.ws.PutAgent("all", workspace.AgentInput{Tools: map[string]string{"*": "auto"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(a.Tools) != len(p.tools.List()) {
		t.Fatalf("%d grants for %d tools", len(a.Tools), len(p.tools.List()))
	}
	for _, g := range a.Tools {
		if g.Level != "auto" {
			t.Errorf("%s granted auto is %s", g.Tool, g.Level)
		}
	}
	for _, name := range []string{"approval_approve", "approval_deny", "agent_put", "agent_rm", "agent_tool_set",
		"agent_tool_rm", "stream", "invite"} {
		if _, err := p.ws.Grant("all", name, "approval"); err == nil {
			t.Errorf("%s was granted", name)
		}
	}
}
