package main

import (
	"context"
	"reflect"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

type environmentName struct {
	Name string `path:"name" doc:"The environment's name"`
}

func (p *plane) environments(a huma.API) {
	ws := p.ws
	huma.Register(a, op("env.ls", "GET", "/environments", "Every environment, and whether a session can fork from it now",
		h0{Output: "table", Columns: []string{"name", "repo", "branch", "tier", "ready"}}),
		func(context.Context, *struct{}) (*body[[]workspace.EnvironmentSummary], error) {
			return answer(ws.Environments())
		})
	huma.Register(a, op("env.get", "GET", "/environments/{name}", "The environment, its secrets' values left out",
		h0{By: []string{"env get", "env var rm", "env secret rm", "env setup ls", "env setup add", "env setup rm",
			"env service ls", "env service add", "env service set", "env service rm"}}),
		func(_ context.Context, in *environmentName) (*body[workspace.Environment], error) {
			return answer(ws.Environment(in.Name))
		})
	huma.Register(a, op("env.put", "PUT", "/environments/{name}", "Declare the environment whole; a secret given empty keeps its value",
		h0{By: []string{"env apply", "env create"}}),
		func(_ context.Context, in *struct {
			Name string `path:"name" doc:"The environment's name"`
			Body workspace.EnvironmentInput
		}) (*struct{}, error) {
			in.Body.Name = in.Name
			return nil, problem(ws.PutEnvironment(in.Body))
		})
	huma.Register(a, op("env.set", "PATCH", "/environments/{name}", "Change the environment's fields; h0 env seed rebuilds its seed",
		h0{Output: "none", By: []string{"env var set", "env var rm", "env secret set", "env secret rm", "env setup add",
			"env setup rm", "env service add", "env service set", "env service rm"}}),
		func(_ context.Context, in *struct {
			Name    string `path:"name" doc:"The environment's name"`
			RawBody []byte `contentType:"application/merge-patch+json"`
		}) (*body[workspace.Environment], error) {
			return answer(ws.PatchEnvironment(in.Name, in.RawBody))
		})
	// The patch is read raw, to tell null from absent; the spec still says what it may hold.
	patch := a.OpenAPI().Paths["/environments/{name}"].Patch.RequestBody.Content["application/merge-patch+json"]
	patch.Schema = a.OpenAPI().Components.Schemas.Schema(reflect.TypeFor[workspace.EnvironmentPatch](), true, "")
	huma.Register(a, op("env.rm", "DELETE", "/environments/{name}", "Remove the environment and its seed; refused while a session uses it",
		h0{Output: "none"}),
		func(ctx context.Context, in *environmentName) (*struct{}, error) {
			return nil, problem(ws.DeleteEnvironment(ctx, in.Name))
		})
}
