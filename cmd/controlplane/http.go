package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/preview"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/workspace"
)

// apiHost: the API, for a bearer token (the CLI). appHost: the web UI, its API under /api for a signed-in browser.
// Every other host is a preview.
func (p *plane) Handler(apiHost, appHost, tokenSHA256 string) http.Handler {
	p.app = appHost
	mux := http.NewServeMux()
	p.API(mux)
	api := p.outside("api", mux)
	api.HandleFunc("GET /sessions/{id}/terminals/{tid}", p.terminal(appHost))

	cli := auth.Bearer(tokenSHA256, mux)
	app := p.outside("app", http.NewServeMux())
	app.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("code") {
			p.auth.Login(w, r)
			return
		}
		serveUI(w, r)
	})
	app.HandleFunc("POST /api/logout", p.auth.Logout)
	app.Handle("/api/", p.auth.SignedIn(http.StripPrefix("/api", mux)))
	app.HandleFunc("/", serveUI)
	previews := p.preview(appHost)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch strings.Split(r.Host, ":")[0] {
		case appHost:
			app.ServeHTTP(w, r)
		case apiHost:
			cli.ServeHTTP(w, r)
		default:
			previews.ServeHTTP(w, r)
		}
	})
}

// A mux whose every pattern is recorded under name: the routes served outside Huma, which TestOutside lists.
type routes struct {
	*http.ServeMux
	name string
	p    *plane
}

func (p *plane) outside(name string, m *http.ServeMux) routes { return routes{m, name, p} }

func (r routes) Handle(pattern string, h http.Handler) {
	r.p.raw = append(r.p.raw, r.name+" "+pattern)
	r.ServeMux.Handle(pattern, h)
}

func (r routes) HandleFunc(pattern string, h func(http.ResponseWriter, *http.Request)) {
	r.Handle(pattern, http.HandlerFunc(h))
}

type routeKey struct{}

func (p *plane) preview(appHost string) http.Handler {
	proxy := &httputil.ReverseProxy{
		ModifyResponse: func(res *http.Response) error {
			preview.Frameable(res, appHost)
			preview.Bridged(res)
			return nil
		},
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme, r.Out.URL.Host = "http", r.In.Host
			r.Out.Host = r.In.Host
			r.SetXForwarded()
			r.Out.Header.Set("X-Forwarded-Proto", "https")
			// A page is asked for uncompressed, so the bridge's script tag can be added to it.
			if preview.Document(r.In) {
				r.Out.Header.Del("Accept-Encoding")
			}
			// The app is reached through boxd: one port per actor, see box.ProxyHeader.
			rt := r.In.Context().Value(routeKey{}).(sandbox.Route)
			r.Out.Header.Set(box.TokenHeader, p.ws.ActorToken(rt.Actor))
			r.Out.Header.Set(box.ProxyHeader, strconv.Itoa(rt.Port))
		},
		Transport: &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return p.Sandboxes.Dial(ctx, ctx.Value(routeKey{}).(sandbox.Route).Actor, box.Port)
		}},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.Split(r.Host, ":")[0]
		if r.URL.Path == preview.BridgePath {
			preview.ServeBridge(w, appHost)
			return
		}
		if !p.gate.Pass(w, r, host) {
			return
		}
		rt, err := p.ws.Route(host)
		if errors.As(err, new(workspace.NotFound)) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// A request open through here, a WebSocket included, is activity for as long as it lasts.
		release, err := p.sc.Enter(r.Context(), rt.Actor, rt.Tier)
		if err != nil {
			http.Error(w, "preview unavailable: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		defer release()
		if err := p.ws.Keyed(r.Context(), rt.Actor); err != nil {
			http.Error(w, "preview unavailable: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), routeKey{}, rt)))
	})
}

// A WebSocket to the session's terminal tid, relayed to boxd. The browser reaches it with its cookie, so a request
// from a page on any other origin is refused.
func (p *plane) terminal(appHost string) http.HandlerFunc {
	relay := box.Relay(func(ctx context.Context, actor string) (net.Conn, error) {
		return p.Sandboxes.Dial(ctx, actor, box.Port)
	},
		p.ws.ActorToken)
	return func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && o != "https://"+appHost {
			writeProblem(w, refusal(http.StatusForbidden, "origin "+o+" is not the app's"))
			return
		}
		if !box.TerminalID.MatchString(r.PathValue("tid")) {
			writeProblem(w, refusal(http.StatusBadRequest, box.ErrBadTerminal.Error()))
			return
		}
		s, env, err := p.ws.Awake(r.Context(), r.PathValue("id"))
		if err != nil {
			reply(w, nil, err)
			return
		}
		release, err := p.sc.Enter(r.Context(), s.Actor, env.Tier)
		if err != nil {
			reply(w, nil, err)
			return
		}
		defer release()
		if err := p.ws.Keyed(r.Context(), s.Actor); err != nil {
			reply(w, nil, err)
			return
		}
		relay.ServeHTTP(w, r.WithContext(box.ForActor(r.Context(), s.Actor)))
	}
}

func read(r *http.Request, v any, then func() error) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return badRequest{err}
	}
	return then()
}

type badRequest struct{ error }

func reply(w http.ResponseWriter, v any, err error) {
	switch {
	case err != nil:
		writeProblem(w, refusal(status(err), err.Error()))
	case v == nil:
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
}
