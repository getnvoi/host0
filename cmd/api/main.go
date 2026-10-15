// The hub: GitHub sign-in for the desktop app, the workspaces it provisions as h0 cluster install does, and each
// workspace's plane behind it. The plane knows nothing of it.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/infra"
	"github.com/getnvoi/host0/internal/shared/seal"
)

type hub struct {
	DB *gorm.DB
	// Where the app and GitHub reach the hub: https://local.hostzero.app.
	URL string
	// The one app address sign-in returns to: h0-dev://auth in development, h0://auth in production.
	Redirect string
	// The zone every workspace's hosts are under.
	Zone string
	// A workspace name the hub refuses: the cluster that serves the hub's own host.
	Reserved     string
	GitHub       githubApp
	HetznerToken string
	HetznerAPI   string
	// The install and the destroy of a workspace, as h0 cluster install and destroy run them.
	Install func(ctx context.Context, w Workspace, l infra.Laptop, out io.Writer) error
	Destroy func(ctx context.Context, w Workspace, out io.Writer) error
	// The plane of a workspace; https://api-<name>.<zone> when nil.
	PlaneURL func(w Workspace) string

	bell bell
}

type body[T any] struct{ Body T }

// Only a request with a device token reaches it.
func (h *hub) signed(o huma.Operation) huma.Operation {
	o.Security = []map[string][]string{{"device": {}}}
	return o
}

func (h *hub) Handler() http.Handler {
	mux := http.NewServeMux()
	cfg := huma.DefaultConfig("h0 hub", "1")
	cfg.OpenAPIPath, cfg.DocsPath, cfg.SchemasPath = "", "", ""
	cfg.CreateHooks = nil
	cfg.Formats["text/plain"] = plain
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"device": {Type: "http", Scheme: "bearer", Description: "The device token POST /v1/auth/token gave."},
	}
	a := humago.New(mux, cfg)
	a.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		if len(ctx.Operation().Security) == 0 {
			next(ctx)
			return
		}
		r, _ := humago.Unwrap(ctx)
		u, err := h.bearer(r)
		if err != nil {
			var s *sentence
			if !errors.As(err, &s) {
				err = fail(err)
			}
			huma.WriteErr(a, ctx, err.(*sentence).status, err.Error())
			return
		}
		next(huma.WithValue(ctx, userKey{}, u))
	})
	h.auth(a)
	h.workspaces(a)
	mux.HandleFunc("GET /v1/workspaces/{ws}/runs/{run}/stream", h.stream)
	mux.HandleFunc("/v1/workspaces/{ws}/plane/", h.forward)
	return mux
}

func must(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("%s is required", name)
	}
	return v
}

func or(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal(err)
	}
	dir := or("H0_HUB_DIR", filepath.Join(home, ".h0", "hub"))
	key, err := hubKey(filepath.Join(dir, "key"))
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "db"), 0o700); err != nil {
		log.Fatal(err)
	}
	gdb, err := db.Open(filepath.Join(dir, "db", "hub.db"), key)
	if err != nil {
		log.Fatal(err)
	}
	if err := migrate(gdb); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	hubURL := strings.TrimSuffix(must("H0_HUB_URL"), "/")
	u, err := url.Parse(hubURL)
	if err != nil {
		log.Fatalf("H0_HUB_URL: %v", err)
	}
	source, err := checkout()
	if err != nil {
		log.Fatal(err)
	}
	ins := installer{HetznerToken: must("HCLOUD_TOKEN"), CloudflareToken: must("CLOUDFLARE_API_TOKEN"), Zone: must("H0_ZONE"),
		SSHKey: or("H0_SSH_KEY", filepath.Join(home, ".ssh", "id_ed25519")), Source: source,
		Cache: filepath.Join(home, ".h0", "cache")}
	h := &hub{DB: gdb, URL: hubURL, Redirect: must("H0_APP_REDIRECT"), Zone: ins.Zone,
		Reserved: strings.Split(u.Hostname(), ".")[0],
		GitHub: githubApp{ClientID: must("GITHUB_APP_CLIENT_ID"), Secret: must("GITHUB_APP_CLIENT_SECRET"), Slug: must("GITHUB_APP_SLUG"),
			Web: "https://github.com", API: "https://api.github.com"},
		HetznerToken: ins.HetznerToken, HetznerAPI: "https://api.hetzner.cloud/v1",
		Install: ins.install, Destroy: ins.destroy}
	if err := h.abandon(); err != nil {
		log.Fatalf("runs left open: %v", err)
	}
	addr := or("H0_HUB_ADDR", "127.0.0.1:5490")
	log.Printf("hub on %s, at %s; sign-in returns to %s; workspaces under %s", addr, hubURL, h.Redirect, h.Zone)
	srv := &http.Server{Addr: addr, Handler: h.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	go reachable(hubURL)
	log.Fatal(srv.ListenAndServe())
}

// Whether the hub answers at its URL, as the app and GitHub reach it: the hub's own refusal of a request without a token.
func reachable(hubURL string) {
	last := ""
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); time.Sleep(3 * time.Second) {
		res, err := outbound.Get(hubURL + "/v1/me")
		got := ""
		if err != nil {
			got = err.Error()
		} else {
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			got = res.Status + " " + string(b)
			if res.StatusCode == http.StatusUnauthorized && strings.Contains(got, "no device token") {
				log.Printf("%s answers: the hub is reachable", hubURL)
				return
			}
		}
		if got != last {
			log.Printf("%s: %s", hubURL, got)
			last = got
		}
	}
	log.Printf("%s does not reach this hub after 2m; last: %s. h0 local up --zone <zone> routes it through the tunnel", hubURL, last)
}

// The hub's sealing key, 32 bytes at path, minted on the first start; the database opens with nothing else.
func hubKey(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, err
		}
		b = seal.Mint()
		log.Printf("sealing key minted at %s: back it up, the hub's records open with nothing else", path)
		return b, os.WriteFile(path, b, 0o600)
	}
	if err != nil {
		return nil, err
	}
	if len(b) != seal.Size {
		return nil, fmt.Errorf("%s is %d bytes, not %d", path, len(b), seal.Size)
	}
	return b, nil
}

// H0_SOURCE, else the checkout the working directory is in: the install builds the plane from it.
func checkout() (string, error) {
	if s := os.Getenv("H0_SOURCE"); s != "" {
		return s, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for ; dir != "/"; dir = filepath.Dir(dir) {
		if b, err := os.ReadFile(filepath.Join(dir, "go.mod")); err == nil && strings.Contains(string(b), "module github.com/getnvoi/host0\n") {
			return dir, nil
		}
	}
	return "", errors.New("H0_SOURCE is not set and the working directory is in no h0 checkout: the install builds the plane from one")
}
