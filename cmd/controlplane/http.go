package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/preview"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/store"
	"github.com/getnvoi/host0/internal/workspace"
)

// apiHost: the API, for a bearer token (the CLI). appHost: the web UI, its API under /api for a signed-in browser.
// Every other host is a preview.
func (p *plane) Handler(apiHost, appHost, tokenSHA256 string) http.Handler {
	ws := p.ws
	mux := http.NewServeMux()
	p.API(mux)
	api := p.outside("api", mux)
	api.Handle("GET /stream", p.bus)
	api.HandleFunc("GET /environments", func(w http.ResponseWriter, r *http.Request) {
		out, err := ws.Environments()
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		out, err := ws.Sessions()
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/queue", func(w http.ResponseWriter, r *http.Request) {
		q := ws.Queue(r.PathValue("id"))
		reply(w, &q, nil)
	})
	api.HandleFunc("DELETE /sessions/{id}/queue/{i}", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Text string }
		i, err := strconv.Atoi(r.PathValue("i"))
		if err != nil {
			reply(w, nil, badRequest{err})
			return
		}
		reply(w, nil, read(r, &in, func() error { return ws.Unqueue(r.PathValue("id"), i, in.Text) }))
	})
	api.HandleFunc("POST /sessions/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.Stop(r.Context(), r.PathValue("id")))
	})
	api.HandleFunc("PUT /credentials", func(w http.ResponseWriter, r *http.Request) {
		var c workspace.Credentials
		reply(w, nil, read(r, &c, func() error { return p.Store.Put("credentials", "default", c) }))
	})
	api.HandleFunc("GET /credentials", func(w http.ResponseWriter, r *http.Request) {
		out := workspace.CredentialsSet{Stored: []string{}}
		var c workspace.Credentials
		err := p.Store.Get("credentials", "default", &c)
		if err == store.ErrNotFound {
			err = nil
		}
		if c.GitHub != "" {
			out.Stored = append(out.Stored, "github")
		}
		reply(w, &out, err)
	})
	api.HandleFunc("DELETE /credentials/{name}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("name") != "github" {
			reply(w, nil, store.ErrNotFound)
			return
		}
		var c workspace.Credentials
		err := p.Store.Get("credentials", "default", &c)
		if err == nil {
			c.GitHub = ""
			err = p.Store.Put("credentials", "default", c)
		}
		reply(w, nil, err)
	})
	api.HandleFunc("PUT /cluster/shape", func(w http.ResponseWriter, r *http.Request) {
		var s sandbox.Shape
		reply(w, nil, read(r, &s, func() error { return p.sc.SetShape(s) }))
	})
	api.HandleFunc("GET /cluster/shape", func(w http.ResponseWriter, r *http.Request) {
		s, err := p.sc.Shape()
		reply(w, &s, err)
	})
	api.HandleFunc("GET /cluster/pods", func(w http.ResponseWriter, r *http.Request) {
		if p.Pods == nil {
			reply(w, nil, fmt.Errorf("this plane reads no pods"))
			return
		}
		ps, err := p.Pods.List(r.Context(), r.URL.Query().Get("node"))
		reply(w, &ps, err)
	})
	api.HandleFunc("GET /cluster/pods/{namespace}/{pod}/log", func(w http.ResponseWriter, r *http.Request) {
		if p.Pods == nil {
			reply(w, nil, fmt.Errorf("this plane reads no pods"))
			return
		}
		tail, err := strconv.Atoi(r.URL.Query().Get("tail"))
		if err != nil || tail <= 0 {
			tail = 200
		}
		log, err := p.Pods.Log(r.Context(), r.PathValue("namespace"), r.PathValue("pod"), r.URL.Query().Get("container"), tail)
		reply(w, &map[string]string{"log": log}, err)
	})
	api.HandleFunc("GET /cluster", func(w http.ResponseWriter, r *http.Request) {
		c, err := p.Status(r.Context())
		reply(w, &c, err)
	})
	api.HandleFunc("GET /llm/providers", func(w http.ResponseWriter, r *http.Request) {
		reply(w, ws.Providers(), nil)
	})
	api.HandleFunc("GET /llm/configs", func(w http.ResponseWriter, r *http.Request) {
		cs, err := ws.Configs()
		reply(w, cs, err)
	})
	api.HandleFunc("POST /llm/configs", func(w http.ResponseWriter, r *http.Request) {
		var in, out workspace.LLMConfig
		reply(w, &out, read(r, &in, func() (err error) { out, err = ws.AddConfig(in); return }))
	})
	api.HandleFunc("PUT /llm/configs/{name}", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Values map[string]string }
		var out workspace.LLMConfig
		reply(w, &out, read(r, &in, func() (err error) { out, err = ws.UpdateConfig(r.PathValue("name"), in.Values); return }))
	})
	api.HandleFunc("POST /llm/configs/{name}/main", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.UseConfig(r.PathValue("name")))
	})
	api.HandleFunc("POST /llm/configs/{name}/restore", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.RestoreConfig(r.PathValue("name")))
	})
	api.HandleFunc("DELETE /llm/configs/{name}", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("remove") != "" {
			reply(w, nil, ws.RemoveConfig(r.PathValue("name")))
			return
		}
		reply(w, nil, ws.ArchiveConfig(r.PathValue("name")))
	})
	api.HandleFunc("PUT /environments/{name}", func(w http.ResponseWriter, r *http.Request) {
		var e workspace.Environment
		reply(w, nil, read(r, &e, func() error { e.Name = r.PathValue("name"); return ws.PutEnvironment(e) }))
	})
	api.HandleFunc("GET /environments/{name}", func(w http.ResponseWriter, r *http.Request) {
		e, err := ws.Environment(r.PathValue("name"))
		reply(w, &e, err)
	})
	api.HandleFunc("PATCH /environments/{name}", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			reply(w, nil, badRequest{err})
			return
		}
		e, err := ws.PatchEnvironment(r.PathValue("name"), b)
		reply(w, &e, err)
	})
	api.HandleFunc("DELETE /environments/{name}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.DeleteEnvironment(r.Context(), r.PathValue("name")))
	})
	api.HandleFunc("POST /environments/{name}/seed", func(w http.ResponseWriter, r *http.Request) {
		if err := ws.Reseed(r.PathValue("name")); err != nil {
			reply(w, nil, err)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
	api.HandleFunc("GET /environments/{name}/seed", func(w http.ResponseWriter, r *http.Request) {
		var s workspace.Seed
		reply(w, &s, p.Store.Get("seeds", r.PathValue("name"), &s))
	})
	api.HandleFunc("POST /sessions", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Env, Prompt string }
		var s workspace.Session
		reply(w, &s, read(r, &in, func() (err error) { s, err = ws.Start(in.Env, in.Prompt, auth.Who(r.Context())); return }))
	})
	api.HandleFunc("GET /sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		var s workspace.Session
		reply(w, &s, p.Store.Get("sessions", r.PathValue("id"), &s))
	})
	api.HandleFunc("DELETE /sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.DeleteSession(r.Context(), r.PathValue("id")))
	})
	api.HandleFunc("POST /sessions/{id}/turns", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Prompt, To string }
		reply(w, nil, read(r, &in, func() error { return ws.Say(r.PathValue("id"), in.Prompt, in.To) }))
	})
	api.HandleFunc("POST /sessions/{id}/suspend", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.Suspend(r.Context(), r.PathValue("id")))
	})
	api.HandleFunc("POST /seeds/{name}/suspend", func(w http.ResponseWriter, r *http.Request) {
		var out struct {
			Actor string `json:"actor"`
		}
		var err error
		out.Actor, err = ws.SuspendSeed(r.Context(), r.PathValue("name"))
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/preview", func(w http.ResponseWriter, r *http.Request) {
		st, err := ws.PreviewStatus(r.Context(), r.PathValue("id"))
		reply(w, &st, err)
	})
	api.HandleFunc("POST /previews", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Host string }
		var out struct {
			URL string `json:"url"`
		}
		reply(w, &out, read(r, &in, func() error {
			var rt sandbox.Route
			if err := p.Store.Get("routes", in.Host, &rt); err != nil {
				// A session still forking has no route yet; its host is known all the same.
				var s workspace.Session
				sid, _, _ := strings.Cut(in.Host, "-")
				if p.Store.Get("sessions", sid, &s) != nil || s.Preview != in.Host {
					return err
				}
			}
			out.URL = p.gate.URL(in.Host, 12*time.Hour)
			return nil
		}))
	})
	api.HandleFunc("GET /sessions/{id}/changes", func(w http.ResponseWriter, r *http.Request) {
		c, err := ws.Changes(r.Context(), r.PathValue("id"))
		reply(w, &c, err)
	})
	api.HandleFunc("GET /sessions/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		out, err := ws.Logs(r.PathValue("id"))
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/logs/{name}", func(w http.ResponseWriter, r *http.Request) {
		offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
		b, next, err := ws.Log(r.Context(), r.PathValue("id"), r.PathValue("name"), offset)
		if err != nil {
			reply(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Offset", strconv.FormatInt(next, 10))
		w.Write(b)
	})
	api.HandleFunc("GET /sessions/{id}/terminals", func(w http.ResponseWriter, r *http.Request) {
		out, err := ws.Terminals(r.Context(), r.PathValue("id"))
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/terminals/{tid}", p.terminal(appHost))
	api.HandleFunc("DELETE /sessions/{id}/terminals/{tid}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, ws.Kill(r.Context(), r.PathValue("id"), r.PathValue("tid")))
	})
	api.HandleFunc("GET /approvals", func(w http.ResponseWriter, r *http.Request) {
		out := []workspace.Approval{}
		session := r.URL.Query().Get("session")
		err := p.Store.List("approvals", func(d func(any) error) error {
			var a workspace.Approval
			if err := d(&a); err != nil {
				return err
			}
			if a.State == "pending" && (session == "" || a.Session == session) {
				out = append(out, a)
			}
			return nil
		})
		reply(w, &out, err)
	})
	api.HandleFunc("GET /approvals/{id}", func(w http.ResponseWriter, r *http.Request) {
		var a workspace.Approval
		reply(w, &a, p.Store.Get("approvals", r.PathValue("id"), &a))
	})
	api.HandleFunc("GET /usage", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		u, err := p.Usage(time.Now(), days, r.URL.Query().Get("by"))
		reply(w, &u, err)
	})
	api.HandleFunc("POST /approvals/{id}/{decision}", func(w http.ResponseWriter, r *http.Request) {
		// Accepted: the action and the outcome turn follow, and the stream tells how they went.
		a, err := ws.Decide(r.PathValue("id"), r.PathValue("decision") == "approve", auth.Who(r.Context()))
		if err != nil {
			reply(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(&a)
	})

	bearer := p.outside("bearer", http.NewServeMux())
	bearer.Handle("/", mux)
	bearer.HandleFunc("POST /login-links", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Label string }
		var out struct {
			URL string `json:"url"`
		}
		reply(w, &out, read(r, &in, func() (err error) { out.URL, err = p.auth.LoginLink(appHost, in.Label); return }))
	})
	bearer.HandleFunc("GET /browsers", func(w http.ResponseWriter, r *http.Request) {
		bs, err := p.auth.Browsers()
		reply(w, &bs, err)
	})
	signOut := func(w http.ResponseWriter, r *http.Request) {
		var out struct {
			Count int `json:"count"`
		}
		var err error
		out.Count, err = p.auth.SignOut(r.PathValue("label"))
		reply(w, &out, err)
	}
	bearer.HandleFunc("DELETE /browsers", signOut)
	bearer.HandleFunc("DELETE /browsers/{label}", signOut)
	cli := auth.Bearer(tokenSHA256, bearer)
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
		var rt sandbox.Route
		if err := p.Store.Get("routes", host, &rt); err != nil {
			http.NotFound(w, r)
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
