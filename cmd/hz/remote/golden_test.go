package remote

import (
	"bytes"
	"encoding/json"
	"flag"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/getnvoi/host0/cmd/hz/state"
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
			asked := false
			mux.HandleFunc(g.route, func(w http.ResponseWriter, r *http.Request) {
				asked = true
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
			if !asked {
				t.Fatalf("hz %v did not ask %s", g.args, g.route)
			}
			file := filepath.Join("testdata", "golden", g.name+".txt")
			if *update {
				if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(file, out.Bytes(), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(out.Bytes(), want) {
				t.Fatalf("hz %v printed\n%s\nwant\n%s", g.args, out.Bytes(), want)
			}
		})
	}
}

var goldens = []golden{
	{"me", []string{"me"}, "GET /me", map[string]string{"cluster": "dev", "zone": "nvoi.to"}},
	{"me-json", []string{"me", "-o", "json"}, "GET /me", map[string]string{"cluster": "dev", "zone": "nvoi.to"}},
}
