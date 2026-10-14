package main

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

type Suspended struct {
	Actor string `json:"actor" doc:"The actor suspended"`
}

func (p *plane) seeds(a huma.API) {
	ws := p.ws
	build := op("env.seed", "POST", "/environments/{name}/seed",
		"Build the environment's seed: clone, set up, start its services, snapshot and tag it", hz{By: []string{"env seed"}})
	build.DefaultStatus = http.StatusAccepted
	huma.Register(a, build, func(_ context.Context, in *environmentName) (*struct{}, error) {
		return nil, problem(ws.Reseed(in.Name))
	})
	huma.Register(a, op("env.status", "GET", "/environments/{name}/seed", "The environment's seed build: the one under way, or the last to end",
		hz{Output: "fields", Columns: []string{"env", "state", "step", "error", "actor", "tag", "preview", "at"}, By: []string{"env seed"}}),
		func(_ context.Context, in *environmentName) (*body[workspace.Seed], error) {
			return answer(ws.SeedOf(in.Name))
		})
	huma.Register(a, op("env.suspend", "POST", "/seeds/{name}/suspend", "Suspend the actor the environment's preview routes to, freeing its worker",
		hz{Output: "fields"}),
		func(ctx context.Context, in *environmentName) (*body[Suspended], error) {
			actor, err := ws.SuspendSeed(ctx, in.Name)
			return answer(Suspended{actor}, err)
		})
}
