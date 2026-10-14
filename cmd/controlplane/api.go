package main

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/getnvoi/host0/internal/auth"
)

// How hz shows an operation: its x-hz extension, which internal/api/hzgen reads. Output is table, fields, raw or
// none; Field picks the part of the answer shown; By names the hand-written commands that stand for it.
type hz struct {
	Output  string   `json:"output,omitempty"`
	Columns []string `json:"columns,omitempty"`
	Field   string   `json:"field,omitempty"`
	By      []string `json:"by,omitempty"`
}

// An operation; its id is the hz command, split on dots.
func op(id, method, path, summary string, x hz) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary,
		Extensions: map[string]any{"x-hz": x}}
}

// Only the CLI's token reaches it, never a browser's cookie.
func bearerOnly(o huma.Operation) huma.Operation {
	o.Security = []map[string][]string{{"bearer": {}}}
	return o
}

type body[T any] struct{ Body T }

// v as the answer, or err as the problem.
func answer[T any](v T, err error) (*body[T], error) {
	if err != nil {
		return nil, problem(err)
	}
	return &body[T]{v}, nil
}

// The plane's API on mux: one Huma operation per route, under a bearer token or a browser's cookie.
func (p *plane) API(mux *http.ServeMux) huma.API {
	cfg := huma.DefaultConfig("hz plane", "1")
	cfg.OpenAPIPath, cfg.DocsPath, cfg.SchemasPath = "", "", ""
	cfg.CreateHooks = nil
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {Type: "http", Scheme: "bearer", Description: "The token hz cluster install mints, on the api host."},
		"cookie": {Type: "apiKey", In: "cookie", Name: "hz_session",
			Description: "A browser signed in with a link, under /api on the app host; a write carries X-Requested-With: hz."},
	}
	cfg.Security = []map[string][]string{{"bearer": {}}, {"cookie": {}}}
	a := humago.New(mux, cfg)
	a.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		o := ctx.Operation()
		if len(o.Security) == 1 && o.Security[0]["bearer"] != nil && auth.Door(ctx.Context()) != auth.ByToken {
			huma.WriteErr(a, ctx, http.StatusNotFound, "only the CLI's token reaches "+o.Method+" "+o.Path)
			return
		}
		next(ctx)
	})
	huma.Register(a, op("me", "GET", "/me", "The cluster and zone this plane serves", hz{Output: "fields"}),
		func(context.Context, *struct{}) (*body[Me], error) {
			return &body[Me]{Me{Cluster: p.Cluster, Zone: p.Zone}}, nil
		})
	p.environments(a)
	p.credentials(a)
	p.seeds(a)
	p.signIns(a)
	return a
}

type Me struct {
	Cluster string `json:"cluster"`
	Zone    string `json:"zone"`
}

// The spec of the plane's API, as internal/api/openapi.yaml holds it.
func spec() ([]byte, error) {
	return (&plane{}).API(http.NewServeMux()).OpenAPI().DowngradeYAML()
}
