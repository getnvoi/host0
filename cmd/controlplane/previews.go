package main

import (
	"context"
	"errors"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/workspace"
)

// How long a preview link lets its visitor in.
const previewFor = 12 * time.Hour

type PreviewInput struct {
	Host string `json:"host" minLength:"1" doc:"The preview's host, as a session or a seed names it"`
}

type PreviewLink struct {
	URL string `json:"url" doc:"Opens the preview past its gate for 12 hours"`
}

func (p *plane) previews(a huma.API) {
	huma.Register(a, op("preview", "POST", "/previews", "A 12-hour link to a preview, past its gate", hz{By: []string{"preview"}}),
		func(_ context.Context, in *struct{ Body PreviewInput }) (*body[PreviewLink], error) {
			if err := p.previewed(in.Body.Host); err != nil {
				return nil, problem(err)
			}
			return answer(PreviewLink{p.gate.URL(in.Body.Host, previewFor)}, nil)
		})
}

// Whether host is a preview: routed, or a session's still forking, whose host is known before its route.
func (p *plane) previewed(host string) error {
	_, err := p.ws.Route(host)
	if !errors.As(err, new(workspace.NotFound)) {
		return err
	}
	sessions, serr := p.ws.Sessions()
	if serr != nil {
		return serr
	}
	for _, s := range sessions {
		if s.Preview == host {
			return nil
		}
	}
	return err
}
