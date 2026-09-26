package controlplane

import (
	"context"
	"net/http"
	"testing"

	"github.com/getnvoi/nvoi/controlplane/box"
	"github.com/getnvoi/nvoi/shared/contract"
)

func TestPreviewStatus(t *testing.T) {
	code := http.StatusBadGateway
	var port, token string
	p, _ := withBox(t, func(w http.ResponseWriter, r *http.Request) {
		port, token = r.Header.Get(box.ProxyHeader), r.Header.Get(box.TokenHeader)
		w.WriteHeader(code)
	})
	p.Store.Put("sessions", "s1", contract.Session{ID: "s1", Env: "web", Actor: "wt-s1", Preview: "s1-dev-preview.x"})
	p.Store.Put("routes", "s1-dev-preview.x", Route{Actor: "wt-s1", Port: 3000, Tier: "medium"})

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
