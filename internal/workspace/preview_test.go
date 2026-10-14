package workspace

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/sandbox"
)

func TestPreviewStatus(t *testing.T) {
	code := http.StatusBadGateway
	var port, token string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		port, token = r.Header.Get(box.ProxyHeader), r.Header.Get(box.TokenHeader)
		w.WriteHeader(code)
	}))
	t.Cleanup(srv.Close)
	p := newWorkspace(t, boxed{addr: srv.Listener.Addr().String()})
	p.Store.Put("sessions", "s1", Session{ID: "s1", Env: "web", Actor: "wt-s1", Preview: "s1-dev-preview.x"})
	if err := p.route(context.Background(), "s1-dev-preview.x", sandbox.Route{Actor: "wt-s1", Port: 3000, Tier: "medium"}); err != nil {
		t.Fatal(err)
	}

	st, err := p.PreviewStatus(context.Background(), "s1")
	if err != nil || st.Up || st.Status != 502 {
		t.Fatalf("starting: %+v %v", st, err)
	}
	if port != "3000" || token != p.derive("actor", "wt-s1") {
		t.Fatalf("not asked through boxd: port %q token %q", port, token)
	}
	code = http.StatusFound
	if st, _ := p.PreviewStatus(context.Background(), "s1"); !st.Up || st.Status != 302 {
		t.Fatalf("a redirect is up: %+v", st)
	}
	if _, err := p.PreviewStatus(context.Background(), "nope"); err == nil {
		t.Fatal("unknown session answered")
	}
}
