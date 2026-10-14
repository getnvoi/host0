package steps

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/infra"
	"github.com/getnvoi/host0/internal/sandbox"
)

// The shape goes to the plane as PUT /cluster/shape with the install's token; a refusal carries the plane's sentence.
func TestShape(t *testing.T) {
	var asked, auth, body string
	refuse := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		asked, auth, body = r.Method+" "+r.URL.Path, r.Header.Get("Authorization"), string(b)
		if refuse {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			io.WriteString(w, `{"status":400,"title":"Bad Request","detail":"no default tier among large"}`)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	e := &infra.Env{Out: io.Discard, Config: infra.Config{WorkerType: "cx33", Location: "nbg1", WorkerMax: 2,
		WorkerIdle: time.Minute, Tiers: sandbox.DefaultTiers}}
	if err := shape(context.Background(), e, srv.URL, "tok"); err != nil {
		t.Fatal(err)
	}
	if asked != "PUT /cluster/shape" || auth != "Bearer tok" ||
		!strings.Contains(body, `"workers":{"type":"cx33","location":"nbg1","max":2,"idle":60000000000}`) {
		t.Fatalf("%s %s %s", asked, auth, body)
	}
	refuse = true
	if err := shape(context.Background(), e, srv.URL, "tok"); err == nil || err.Error() != "writing the cluster shape: no default tier among large" {
		t.Fatalf("refused: %v", err)
	}
}
