// The tools the agent sees, served to it by boxd mcp. An environment's policy decides whether each runs at once, waits
// for an approval, or is refused; what a tool does happens here, outside the sandbox.
package tools

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"

	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/scm"
)

type Tool interface {
	Name() string
	Description() string
	// Each argument's name and JSON type; all are required.
	Args() map[string]string
	// The policy when the environment sets none: auto for a tool that touches nothing outside the sandbox.
	Policy() string
	// What the agent is told it did: "<name>: <what happened>".
	Do(ctx context.Context, c *Call, in Input) string
}

type Input struct{ Title, Body, Path string }

// What a tool acts on: the session's sandbox and branch, its environment's repository.
type Call struct {
	Box   box.Client
	Forge scm.Forge
	// The GitHub token, which never enters the sandbox.
	Token string
	// The checkout in the sandbox.
	Dir                string
	Repo, Base, Branch string
	// The session's title; set_title changes it.
	Title string
	// Told each boxd run a tool starts, so a stop can end it.
	Started func(run string)
}

var All = []Tool{SetTitle{}, PushBranch{}, PullRequest{}, NavigatePreview{}}

// The MCP definitions boxd serves.
func Spec() []map[string]any {
	out := make([]map[string]any, len(All))
	for i, t := range All {
		out[i] = map[string]any{"name": t.Name(), "description": t.Description(), "inputSchema": schema(t.Args())}
	}
	return out
}

// The policy of the tool name when its environment leaves it unset.
func Policy(name string) string {
	for _, t := range All {
		if t.Name() == name {
			return t.Policy()
		}
	}
	return ""
}

// Runs the tool name with the JSON input the agent gave it.
func Do(ctx context.Context, c *Call, name, input string) string {
	var in Input
	json.Unmarshal([]byte(input), &in)
	for _, t := range All {
		if t.Name() == name {
			return t.Do(ctx, c, in)
		}
	}
	return name + ": unknown tool"
}

func schema(props map[string]string) map[string]any {
	p := map[string]any{}
	req := []string{}
	for k, t := range props {
		p[k] = map[string]string{"type": t}
		req = append(req, k)
	}
	return map[string]any{"type": "object", "properties": p, "required": req}
}

func id() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}
