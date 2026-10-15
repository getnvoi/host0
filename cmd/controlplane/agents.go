package main

import (
	"context"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

type agentName struct {
	Name string `path:"name" doc:"The agent's name"`
}

type agentTool struct {
	Name string `path:"name" doc:"The agent's name"`
	Tool string `path:"tool" doc:"The tool's name: an operation id, dots as underscores (session_push)"`
}

func (p *plane) agents(a huma.API) {
	ws := p.ws
	huma.Register(a, op("agent.ls", "GET", "/agents", "The agents sessions run as",
		hz{Output: "table", Columns: []string{"name", "model", "description"}}),
		func(context.Context, *struct{}) (*body[[]workspace.Agent], error) {
			return answer(ws.Agents())
		})
	tools := hz{Output: "table", Field: "tools", Columns: []string{"tool", "level", "rule"}}
	huma.Register(a, op("agent.show", "GET", "/agents/{name}", "The agent's level for every tool: its rule, or the tool's default",
		tools),
		func(_ context.Context, in *agentName) (*body[workspace.Agent], error) {
			return answer(ws.Agent(in.Name))
		})
	// An agent never changes what it, or another agent, may do.
	set := tools
	set.Tool = "deny"
	huma.Register(a, op("agent.put", "PUT", "/agents/{name}",
		"Declare the agent: its description, model, instructions and rules, which replace those it has", set),
		func(_ context.Context, in *struct {
			Name string `path:"name" doc:"The agent's name"`
			Body workspace.AgentInput
		}) (*body[workspace.Agent], error) {
			return answer(ws.PutAgent(in.Name, in.Body))
		})
	huma.Register(a, op("agent.tool.set", "PUT", "/agents/{name}/tools/{tool}", "Set the agent's level for a tool", set),
		func(_ context.Context, in *struct {
			Name string `path:"name" doc:"The agent's name"`
			Tool string `path:"tool" doc:"The tool's name: an operation id, dots as underscores (session_push)"`
			Body workspace.Level
		}) (*body[workspace.Agent], error) {
			return answer(ws.SetRule(in.Name, in.Tool, in.Body.Level))
		})
	huma.Register(a, op("agent.tool.rm", "DELETE", "/agents/{name}/tools/{tool}", "Drop the agent's rule for a tool: its default applies",
		set),
		func(_ context.Context, in *agentTool) (*body[workspace.Agent], error) {
			return answer(ws.DropRule(in.Name, in.Tool))
		})
}
