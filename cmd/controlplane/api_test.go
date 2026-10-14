package main

import (
	"bytes"
	"slices"
	"testing"

	"github.com/getnvoi/host0/internal/api"
)

// internal/api/openapi.yaml is the spec this plane serves.
func TestSpec(t *testing.T) {
	b, err := spec()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b, api.Spec) {
		t.Fatal("internal/api/openapi.yaml is not the plane's spec: go generate ./internal/api")
	}
}

// The routes served outside Huma, each for the reason beside it.
func TestOutside(t *testing.T) {
	p, _ := handler(t)
	want := []string{
		"api GET /sessions/{id}/terminals/{tid}", // a WebSocket, relayed to boxd
		"app GET /login",                         // trades a link's code for a cookie and redirects
		"app POST /api/logout",                   // clears the cookie it came with
		"app /api/",                              // the API, for a signed-in browser
		"app /",                                  // the web UI
	}
	want = append(want, moving...)
	slices.Sort(want)
	raw := slices.Sorted(slices.Values(p.raw))
	if !slices.Equal(raw, want) {
		t.Fatalf("outside Huma:\n%q\nwant\n%q", raw, want)
	}
}

// The routes still to move into Huma.
var moving = []string{"api GET /stream", "api GET /sessions", "api GET /sessions/{id}/queue",
	"api DELETE /sessions/{id}/queue/{i}", "api POST /sessions/{id}/stop", "api PUT /credentials", "api GET /credentials",
	"api DELETE /credentials/{name}", "api PUT /cluster/shape", "api GET /cluster/shape", "api GET /cluster/pods",
	"api GET /cluster/pods/{namespace}/{pod}/log", "api GET /cluster", "api GET /llm/providers", "api GET /llm/configs",
	"api POST /llm/configs", "api PUT /llm/configs/{name}", "api POST /llm/configs/{name}/main",
	"api POST /llm/configs/{name}/restore", "api DELETE /llm/configs/{name}", "api POST /environments/{name}/seed", "api GET /environments/{name}/seed", "api POST /sessions", "api GET /sessions/{id}",
	"api DELETE /sessions/{id}", "api POST /sessions/{id}/turns", "api POST /sessions/{id}/suspend",
	"api POST /seeds/{name}/suspend", "api GET /sessions/{id}/preview", "api POST /previews", "api GET /sessions/{id}/changes",
	"api GET /sessions/{id}/logs", "api GET /sessions/{id}/logs/{name}", "api GET /sessions/{id}/terminals",
	"api DELETE /sessions/{id}/terminals/{tid}", "api GET /approvals", "api GET /approvals/{id}", "api GET /usage",
	"api POST /approvals/{id}/{decision}", "bearer /", "bearer POST /login-links", "bearer GET /browsers",
	"bearer DELETE /browsers", "bearer DELETE /browsers/{label}"}
