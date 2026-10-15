package main

import (
	"context"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

type agentSlug struct {
	Slug string `path:"slug" doc:"The agent's slug"`
}

type agentTool struct {
	Slug string `path:"slug" doc:"The agent's slug"`
	Tool string `path:"tool" doc:"The tool's name: an operation id, dots as underscores (session_push)"`
}

func (p *plane) agents(a huma.API) {
	ws := p.ws
	huma.Register(a, op("agent.ls", "GET", "/agents", "The agents sessions run as",
		hz{Output: "table", Columns: []string{"slug", "name"}}),
		func(context.Context, *struct{}) (*body[[]workspace.Agent], error) {
			return answer(ws.Agents())
		})
	tools := hz{Output: "table", Field: "tools", Columns: []string{"tool", "level", "rule"}}
	huma.Register(a, op("agent.show", "GET", "/agents/{slug}", "The agent's level for every tool: its rule, or the tool's default",
		tools),
		func(_ context.Context, in *agentSlug) (*body[workspace.Agent], error) {
			return answer(ws.Agent(in.Slug))
		})
	// An agent never changes what it, or another agent, may do.
	set := tools
	set.Tool = "deny"
	huma.Register(a, op("agent.tool.set", "PUT", "/agents/{slug}/tools/{tool}", "Set the agent's level for a tool", set),
		func(_ context.Context, in *struct {
			Slug string `path:"slug" doc:"The agent's slug"`
			Tool string `path:"tool" doc:"The tool's name: an operation id, dots as underscores (session_push)"`
			Body workspace.Level
		}) (*body[workspace.Agent], error) {
			return answer(ws.SetRule(in.Slug, in.Tool, in.Body.Level))
		})
	huma.Register(a, op("agent.tool.rm", "DELETE", "/agents/{slug}/tools/{tool}", "Drop the agent's rule for a tool: its default applies",
		set),
		func(_ context.Context, in *agentTool) (*body[workspace.Agent], error) {
			return answer(ws.DropRule(in.Slug, in.Tool))
		})
}
