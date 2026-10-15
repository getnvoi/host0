package main

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/getnvoi/host0/internal/auth"
)

// How h0 shows an operation: its x-h0 extension, which internal/api/h0gen reads. Output is table, fields, raw or
// none; Field picks the part of the answer shown; By names the hand-written commands that stand for it. Tool is the
// level a grant at default gives it; empty is auto for a read, approval for a write. NoTool keeps it from agents.
type h0 struct {
	Output  string   `json:"output,omitempty"`
	Columns []string `json:"columns,omitempty"`
	Field   string   `json:"field,omitempty"`
	By      []string `json:"by,omitempty"`
	Words   string   `json:"words,omitempty"` // the query parameter the command's arguments fill, joined by spaces
	Tool    string   `json:"tool,omitempty"`  // the level "default" grants it at: auto or approval
	// Never an agent's tool: no agent can be granted it.
	NoTool bool `json:"noTool,omitempty"`
}

// An operation; its id is the h0 command, split on dots.
func op(id, method, path, summary string, x h0) huma.Operation {
	return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary,
		Extensions: map[string]any{"x-h0": x}}
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
	cfg := huma.DefaultConfig("h0 plane", "1")
	cfg.OpenAPIPath, cfg.DocsPath, cfg.SchemasPath = "", "", ""
	cfg.CreateHooks = nil
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"bearer": {Type: "http", Scheme: "bearer", Description: "The token h0 cluster install mints, on the api host."},
		"cookie": {Type: "apiKey", In: "cookie", Name: "h0_session",
			Description: "A browser signed in with a link, under /api on the app host; a write carries X-Requested-With: h0."},
	}
	cfg.Security = []map[string][]string{{"bearer": {}}, {"cookie": {}}}
	cfg.Transformers = append(cfg.Transformers, func(_ huma.Context, _ string, v any) (any, error) { return p.masked(v), nil })
	a := humago.New(mux, cfg)
	a.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		o := ctx.Operation()
		if len(o.Security) == 1 && o.Security[0]["bearer"] != nil && auth.Door(ctx.Context()) != auth.ByToken {
			huma.WriteErr(a, ctx, http.StatusNotFound, "only the CLI's token reaches "+o.Method+" "+o.Path)
			return
		}
		next(ctx)
	})
	huma.Register(a, op("me", "GET", "/me", "The cluster and zone this plane serves", h0{Output: "fields"}),
		func(context.Context, *struct{}) (*body[Me], error) {
			return &body[Me]{Me{Cluster: p.Cluster, Zone: p.Zone}}, nil
		})
	p.environments(a)
	p.credentials(a)
	p.seeds(a)
	p.sessions(a)
	p.approvals(a)
	p.signIns(a)
	p.cluster(a)
	p.previews(a)
	p.usage(a)
	p.agents(a)
	p.search(a)
	p.tools.load(a, mux)
	return a
}

type Me struct {
	Cluster string `json:"cluster"`
	Zone    string `json:"zone"`
}

// The spec of the plane's API, as internal/api/openapi.yaml holds it.
func spec() ([]byte, error) {
	o := (&plane{}).API(http.NewServeMux()).OpenAPI()
	reuse(o.Components.Schemas)
	return o.DowngradeYAML()
}

// The contracts whose types the generated client takes as they are rather than generating its own.
var contracts = []string{"github.com/getnvoi/host0/internal/llm", "github.com/getnvoi/host0/internal/sandbox"}

// Marks each schema of a contract's type with x-go-type, so oapi-codegen imports the type.
func reuse(r huma.Registry) {
	for name, s := range r.Map() {
		t := r.TypeFromRef("#/components/schemas/" + name)
		if t == nil || !slices.Contains(contracts, t.PkgPath()) {
			continue
		}
		if s.Extensions == nil {
			s.Extensions = map[string]any{}
		}
		pkg := t.PkgPath()[strings.LastIndex(t.PkgPath(), "/")+1:]
		s.Extensions["x-go-type"] = pkg + "." + t.Name()
		s.Extensions["x-go-type-import"] = map[string]string{"path": t.PkgPath()}
	}
}
