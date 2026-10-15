package workspace

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/publicdns"
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
	sessionRow(t, p, Session{ID: "s1", Env: "web", Actor: "wt-s1", Preview: "s1-dev-preview.x"})
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

// A route is done once its host is published; one that is not fails the route with the reason.
func TestRouteWaitsForPublished(t *testing.T) {
	p := newWorkspace(t, nil)
	var asked []string
	p.Published = func(_ context.Context, host string) error {
		asked = append(asked, host)
		if host == "late-dev-preview.x" {
			return errors.New("late-dev-preview.x is not published in 5m0s")
		}
		return nil
	}
	if err := p.route(context.Background(), "s1-dev-preview.x", sandbox.Route{Actor: "wt-s1", Port: 3000}); err != nil {
		t.Fatal(err)
	}
	if err := p.route(context.Background(), "late-dev-preview.x", sandbox.Route{Actor: "wt-s2", Port: 3000}); err == nil ||
		!strings.Contains(err.Error(), "not published") {
		t.Fatalf("unpublished: %v", err)
	}
	if len(asked) != 2 {
		t.Fatalf("asked %v", asked)
	}
}

// Resolvers that cannot be reached leave the route made: the link goes out unchecked.
func TestRouteWithoutResolvers(t *testing.T) {
	p := newWorkspace(t, nil)
	p.Published = func(context.Context, string) error {
		return fmt.Errorf("%w for x: 1.1.1.1:53: i/o timeout", publicdns.ErrUnreachable)
	}
	if err := p.route(context.Background(), "s1-dev-preview.x", sandbox.Route{Actor: "wt-s1", Port: 3000}); err != nil {
		t.Fatal(err)
	}
}
