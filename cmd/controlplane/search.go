package main

import (
	"context"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

func (p *plane) search(a huma.API) {
	huma.Register(a, op("search", "GET", "/search",
		"Sessions' titles, events, queued messages and notes holding every word, the best match first; removed sessions too",
		h0{Output: "table", Columns: []string{"session", "env", "removed", "in", "kind", "position", "snippet"}, Words: "q"}),
		func(_ context.Context, in *struct {
			Q     string `query:"q" required:"true" doc:"Words, or \"quoted phrases\", that must all match"`
			Limit int    `query:"limit" default:"20" minimum:"1" maximum:"100" doc:"The most hits answered"`
		}) (*body[[]workspace.Hit], error) {
			return answer(p.ws.Search(in.Q, in.Limit))
		})
}
