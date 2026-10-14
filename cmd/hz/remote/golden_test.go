package remote

import (
	"bytes"
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/cmd/hz/state"
	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/workspace"
)

var update = flag.Bool("update", false, "rewrite testdata/golden from what the commands print")

type golden struct {
	name   string
	args   []string
	route  string // the request the command makes, as a ServeMux pattern
	answer any    // the plane's answer to it, as JSON; a string is sent as text/plain
}

// What generated commands print, against a plane answering each request with its wire types.
func TestGolden(t *testing.T) {
	for _, g := range goldens {
		t.Run(g.name, func(t *testing.T) {
			mux := http.NewServeMux()
			asked := ""
			mux.HandleFunc(g.route, func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				asked = strings.TrimSpace("> " + r.Method + " " + r.URL.RequestURI() + " " + string(b))
				if r.Header.Get("Authorization") != "Bearer cli-token" {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				if s, ok := g.answer.(string); ok {
					w.Header().Set("Content-Type", "text/plain; charset=utf-8")
					w.Write([]byte(s))
					return
				}
				if g.answer == nil {
					w.WriteHeader(http.StatusNoContent)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(g.answer)
			})
			srv := httptest.NewServer(mux)
			defer srv.Close()
			t.Setenv("HOME", t.TempDir())
			if err := state.Save(state.State{URL: srv.URL, Token: "cli-token"}); err != nil {
				t.Fatal(err)
			}
			r := root()
			var out bytes.Buffer
			r.SetOut(&out)
			r.SetArgs(g.args)
			r.SilenceUsage, r.SilenceErrors = true, true
			if err := r.Execute(); err != nil {
				t.Fatal(err)
			}
			if asked == "" {
				t.Fatalf("hz %v did not ask %s", g.args, g.route)
			}
			got := append([]byte(asked+"\n"), out.Bytes()...)
			file := filepath.Join("testdata", "golden", g.name+".txt")
			if *update {
				if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, got, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("hz %v printed\n%s\nwant\n%s", g.args, got, want)
			}
		})
	}
}

var goldens = []golden{
	{"me", []string{"me"}, "GET /me", map[string]string{"cluster": "dev", "zone": "nvoi.to"}},
	{"me-json", []string{"me", "-o", "json"}, "GET /me", map[string]string{"cluster": "dev", "zone": "nvoi.to"}},
	{"env-ls", []string{"env", "ls"}, "GET /environments", []workspace.EnvironmentSummary{
		{Name: "shop", Repo: "acme/shop", Branch: "main", Tier: "medium", Ready: true}, {Name: "api", Repo: "acme/api", Branch: "dev"}}},
	{"env-rm", []string{"env", "rm", "shop"}, "DELETE /environments/shop", nil},
	{"env-set", []string{"env", "set", "shop", "--image", "ruby:3"}, "PATCH /environments/shop",
		workspace.Environment{Name: "shop", Image: "ruby:3"}},
	{"credentials-rm", []string{"credentials", "rm", "github"}, "DELETE /credentials/github", nil},
	{"llm-ls", []string{"llm", "ls"}, "GET /llm/configs", []workspace.LLMConfig{
		{Name: "Claude Code", Provider: "claude_code", Values: map[string]string{"kind": "oauth"}, Stored: []string{"token"}, Main: true},
		{Name: "OpenAI", Provider: "codex", Values: map[string]string{"kind": "api_key", "model": "gpt-5"}, Stored: []string{"token"},
			Archived: &archived}}},
	{"llm-providers", []string{"llm", "providers"}, "GET /llm/providers", []llm.Provider{{Key: "claude_code", Label: "Claude Code"}}},
	{"llm-rm", []string{"llm", "rm", "Claude Code", "--remove"}, "DELETE /llm/configs/{name}", nil},
	{"env-status", []string{"env", "status", "shop"}, "GET /environments/shop/seed", workspace.Seed{Env: "shop", State: "building",
		Step: "setup: npm ci", Actor: "shop-1a2b3c4d5e", At: archived}},
	{"env-suspend", []string{"env", "suspend", "shop"}, "POST /seeds/shop/suspend", map[string]string{"actor": "shop-1a2b3c4d5e"}},
	{"session-ls", []string{"session", "ls", "--env", "shop"}, "GET /sessions", []workspace.Summary{{ID: "a1b2c3d4", Env: "shop",
		State: "idle", Queued: 1, By: "ben", Last: archived, Title: "Fix the cart"}}},
	{"session-show", []string{"session", "show", "a1b2c3d4"}, "GET /sessions/a1b2c3d4", workspace.Session{ID: "a1b2c3d4",
		Env: "shop", State: "idle", Branch: "hz/a1b2c3d4", Turns: 2, By: "ben", At: archived, Title: "Fix the cart"}},
	{"session-rm", []string{"session", "rm", "a1b2c3d4"}, "DELETE /sessions/a1b2c3d4", nil},
	{"session-stop", []string{"session", "stop", "a1b2c3d4"}, "POST /sessions/a1b2c3d4/stop", nil},
	{"session-suspend", []string{"session", "suspend", "a1b2c3d4"}, "POST /sessions/a1b2c3d4/suspend", nil},
	{"session-queue-ls", []string{"session", "queue", "ls", "a1b2c3d4"}, "GET /sessions/a1b2c3d4/queue", []string{"next", "then"}},
	{"session-preview", []string{"session", "preview", "a1b2c3d4"}, "GET /sessions/a1b2c3d4/preview", workspace.PreviewStatus{Up: true, Status: 200}},
	{"session-changes", []string{"session", "changes", "a1b2c3d4"}, "GET /sessions/a1b2c3d4/changes", workspace.Changes{Base: "origin/main",
		Files: []workspace.FileChange{{Path: "app/cart.rb", Status: "modified", Added: 3, Removed: 1}}}},
	{"session-log-ls", []string{"session", "log", "ls", "a1b2c3d4"}, "GET /sessions/a1b2c3d4/logs", []workspace.Log{{Name: "setup", Kind: "setup"}}},
	{"session-terminal-ls", []string{"session", "terminal", "ls", "a1b2c3d4"}, "GET /sessions/a1b2c3d4/terminals", []box.Terminal{{ID: "t1", Command: "bash", Clients: 1}}},
	{"session-terminal-rm", []string{"session", "terminal", "rm", "a1b2c3d4", "t1"}, "DELETE /sessions/a1b2c3d4/terminals/t1", nil},
	{"llm-use", []string{"llm", "use", "OpenAI"}, "POST /llm/configs/OpenAI/main", nil},
}

var archived = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
