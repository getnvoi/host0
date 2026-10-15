package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/scm"
	"github.com/getnvoi/host0/internal/shared/naming"
)

// The plane of w: https://api-<name>.<zone>, as its install serves it.
func (h *hub) planeURL(w Workspace) string {
	if h.PlaneURL != nil {
		return h.PlaneURL(w)
	}
	return "https://" + naming.Host(naming.Cluster{Name: w.Name}, "api", h.Zone)
}

func (h *hub) plane(w Workspace) (*client.Client, error) {
	if w.Token == "" {
		return nil, said(http.StatusServiceUnavailable, "workspace %s is not ready: its install has not finished", w.Name)
	}
	return client.NewClient(h.planeURL(w), client.WithHTTPClient(planeClient),
		client.WithRequestEditorFn(func(_ context.Context, r *http.Request) error {
			r.Header.Set("Authorization", "Bearer "+w.Token)
			return nil
		}))
}

var planeClient = &http.Client{Timeout: 30 * time.Second}

// Asked now: the plane answers its me with its token.
func (h *hub) ready(ctx context.Context, w Workspace) bool {
	c, err := h.plane(w)
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return client.Done(c.Me(ctx)) == nil
}

// Hands the plane of w the user's GitHub token, as h0 credentials does; the hub keeps no copy.
func (h *hub) handGitHub(ctx context.Context, w Workspace, token string) error {
	c, err := h.plane(w)
	if err != nil {
		return err
	}
	if err := client.Done(c.CredentialsPut(ctx, client.CredentialsInput{Github: &token})); err != nil {
		return fmt.Errorf("workspace %s did not take the GitHub token: %w", w.Name, err)
	}
	return nil
}

// What the GitHub App reaches, asked of the plane with the GitHub token it holds.
func (h *hub) repositories(ctx context.Context, w Workspace) ([]scm.Repository, error) {
	c, err := h.plane(w)
	if err != nil {
		return nil, err
	}
	set, err := client.Read[client.CredentialsSet](c.CredentialsGet(ctx))
	if err != nil {
		return nil, fmt.Errorf("workspace %s: %w", w.Name, err)
	}
	if set.Stored == nil || !slices.Contains(*set.Stored, "github") {
		return nil, said(http.StatusUnauthorized, "Sign in with GitHub again: workspace %s does not hold your GitHub token yet.", w.Name)
	}
	rs, err := client.Read[[]scm.Repository](c.GithubRepositories(ctx))
	if err != nil {
		return nil, fmt.Errorf("workspace %s: %w", w.Name, err)
	}
	return rs, nil
}

// /v1/workspaces/{ws}/plane/<route> to the plane's <route>, under the plane's token; streams flush as they come.
func (h *hub) forward(w http.ResponseWriter, r *http.Request) {
	ws, err := h.workspaceOf(r)
	if err != nil {
		write(w, err)
		return
	}
	if ws.Token == "" {
		write(w, said(http.StatusServiceUnavailable, "workspace %s is not ready: its install has not finished", ws.Name))
		return
	}
	target, err := url.Parse(h.planeURL(ws))
	if err != nil {
		write(w, err)
		return
	}
	prefix := "/v1/workspaces/" + ws.Name + "/plane"
	p := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path = strings.TrimSuffix(target.Path, "/") + strings.TrimPrefix(r.URL.Path, prefix)
			pr.Out.URL.RawPath = ""
			pr.Out.Header.Set("Authorization", "Bearer "+ws.Token)
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			write(w, said(http.StatusBadGateway, "workspace %s's plane does not answer: %v", ws.Name, err))
		},
	}
	p.ServeHTTP(w, r)
}
