package main

import (
	"bufio"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/api"
	"github.com/getnvoi/host0/internal/workspace"
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

// The stream through Huma: server-sent events whose first message says where the stream stands.
func TestStream(t *testing.T) {
	p, h := handler(t)
	srv := httptest.NewServer(h)
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/stream", nil)
	req.Host = "api-dev.nvoi.to"
	req.Header.Set("Authorization", "Bearer cli-token")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("%s %s", res.Status, res.Header.Get("Content-Type"))
	}
	r := bufio.NewReader(res.Body)
	if line, _ := r.ReadString('\n'); !strings.HasPrefix(line, "id: ") {
		t.Fatalf("first line %q", line)
	}
	p.bus.Publish(workspace.Update{Kind: "reset"})
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "data: ") {
			if line != "data: {\"kind\":\"reset\",\"from\":0}\n" {
				t.Fatalf("data %q", line)
			}
			return
		}
	}
}

// A body that is not what the operation takes is refused 400, every reason in one sentence.
func TestValidation(t *testing.T) {
	_, h := handler(t)
	res := call(h, "POST", "api-dev.nvoi.to", "/sessions", `{"env":1,"bogus":true}`, bearer)
	if res.Code != 400 || res.Header().Get("Content-Type") != "application/problem+json" ||
		!strings.Contains(detail(res), "body.env: expected string") || !strings.Contains(detail(res), "bogus") {
		t.Fatalf("%d %s %s", res.Code, res.Header().Get("Content-Type"), res.Body)
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
var moving = []string{"api PUT /cluster/shape", "api GET /cluster/shape", "api GET /cluster/pods",
	"api GET /cluster/pods/{namespace}/{pod}/log", "api GET /cluster", "api POST /previews", "api GET /usage",
	"bearer /", "bearer POST /login-links", "bearer GET /browsers",
	"bearer DELETE /browsers", "bearer DELETE /browsers/{label}"}
