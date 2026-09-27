package controlplane

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httputil"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/nvoi/controlplane/box"
	"github.com/getnvoi/nvoi/controlplane/llm"
	"github.com/getnvoi/nvoi/shared/contract"
)

func basic(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

// apiHost: the API, for a bearer token (the CLI). appHost: the web UI, its API under /api for a signed-in browser.
// Every other host is a preview.
func (p *Plane) Handler(apiHost, appHost, tokenSHA256 string) http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /me", func(w http.ResponseWriter, r *http.Request) {
		reply(w, &map[string]string{"cluster": p.Cluster, "zone": p.Zone}, nil)
	})
	api.HandleFunc("GET /stream", p.stream)
	api.HandleFunc("GET /environments", func(w http.ResponseWriter, r *http.Request) {
		out := []contract.EnvironmentSummary{}
		err := p.Store.List("environments", func(d func(any) error) error {
			var e contract.Environment
			if err := d(&e); err != nil {
				return err
			}
			_, err := p.served(e.Name)
			ready := err == nil
			out = append(out, contract.EnvironmentSummary{Name: e.Name, Repo: e.Repo, Branch: e.Branch, Tier: e.Tier, Ready: ready})
			return nil
		})
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions", func(w http.ResponseWriter, r *http.Request) {
		out := []contract.Summary{}
		err := p.Store.List("sessions", func(d func(any) error) error {
			var s contract.Session
			if err := d(&s); err != nil {
				return err
			}
			sum := s.Summary()
			sum.Queued = p.queued(s.ID)
			out = append(out, sum)
			return nil
		})
		sort.Slice(out, func(i, j int) bool { return out[i].Last.After(out[j].Last) })
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/queue", func(w http.ResponseWriter, r *http.Request) {
		q := p.Queue(r.PathValue("id"))
		reply(w, &q, nil)
	})
	api.HandleFunc("DELETE /sessions/{id}/queue/{i}", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Text string }
		i, err := strconv.Atoi(r.PathValue("i"))
		if err != nil {
			reply(w, nil, badRequest{err})
			return
		}
		reply(w, nil, read(r, &in, func() error { return p.Unqueue(r.PathValue("id"), i, in.Text) }))
	})
	api.HandleFunc("POST /sessions/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, p.Stop(r.Context(), r.PathValue("id")))
	})
	api.HandleFunc("PUT /credentials", func(w http.ResponseWriter, r *http.Request) {
		var c contract.Credentials
		reply(w, nil, read(r, &c, func() error {
			_, values, err := llm.Check(Runners, c.LLM)
			if err != nil {
				return badRequest{err}
			}
			c.LLM.Values = values
			return p.Store.Put("credentials", "default", c)
		}))
	})
	api.HandleFunc("PUT /environments/{name}", func(w http.ResponseWriter, r *http.Request) {
		var e contract.Environment
		reply(w, nil, read(r, &e, func() error { e.Name = r.PathValue("name"); return p.Store.Put("environments", e.Name, e) }))
	})
	api.HandleFunc("POST /environments/{name}/seed", func(w http.ResponseWriter, r *http.Request) {
		if err := p.Reseed(r.PathValue("name")); err != nil {
			reply(w, nil, err)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
	api.HandleFunc("GET /environments/{name}/seed", func(w http.ResponseWriter, r *http.Request) {
		var s contract.Seed
		reply(w, &s, p.Store.Get("seeds", r.PathValue("name"), &s))
	})
	api.HandleFunc("POST /sessions", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Env, Prompt string }
		var s contract.Session
		reply(w, &s, read(r, &in, func() (err error) { s, err = p.Start(in.Env, in.Prompt, who(r.Context())); return }))
	})
	api.HandleFunc("GET /sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		var s contract.Session
		reply(w, &s, p.Store.Get("sessions", r.PathValue("id"), &s))
	})
	api.HandleFunc("POST /sessions/{id}/turns", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Prompt, To string }
		reply(w, nil, read(r, &in, func() error { return p.Say(r.PathValue("id"), in.Prompt, in.To) }))
	})
	api.HandleFunc("POST /sessions/{id}/suspend", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, p.Suspend(r.Context(), r.PathValue("id")))
	})
	api.HandleFunc("POST /seeds/{name}/suspend", func(w http.ResponseWriter, r *http.Request) {
		var s contract.Seed
		err := p.Store.Get("seeds", r.PathValue("name"), &s)
		if err == nil {
			err = p.Sandboxes.Suspend(r.Context(), s.Actor)
		}
		reply(w, nil, err)
	})
	api.HandleFunc("GET /sessions/{id}/preview", func(w http.ResponseWriter, r *http.Request) {
		st, err := p.PreviewStatus(r.Context(), r.PathValue("id"))
		reply(w, &st, err)
	})
	api.HandleFunc("POST /previews", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Host string }
		var out struct {
			URL string `json:"url"`
		}
		reply(w, &out, read(r, &in, func() error {
			var rt Route
			if err := p.Store.Get("routes", in.Host, &rt); err != nil {
				// A session still forking has no route yet; its host is known all the same.
				var s contract.Session
				sid, _, _ := strings.Cut(in.Host, "-")
				if p.Store.Get("sessions", sid, &s) != nil || s.Preview != in.Host {
					return err
				}
			}
			out.URL = p.PreviewURL(in.Host, 12*time.Hour)
			return nil
		}))
	})
	api.HandleFunc("GET /sessions/{id}/changes", func(w http.ResponseWriter, r *http.Request) {
		c, err := p.Changes(r.Context(), r.PathValue("id"))
		reply(w, &c, err)
	})
	api.HandleFunc("GET /sessions/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		out, err := p.Logs(r.PathValue("id"))
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/logs/{name}", func(w http.ResponseWriter, r *http.Request) {
		offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
		b, next, err := p.Log(r.Context(), r.PathValue("id"), r.PathValue("name"), offset)
		if err != nil {
			reply(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Offset", strconv.FormatInt(next, 10))
		w.Write(b)
	})
	api.HandleFunc("GET /sessions/{id}/terminals", func(w http.ResponseWriter, r *http.Request) {
		out, err := p.Terminals(r.Context(), r.PathValue("id"))
		reply(w, &out, err)
	})
	api.HandleFunc("GET /sessions/{id}/terminals/{tid}", p.terminal(appHost))
	api.HandleFunc("DELETE /sessions/{id}/terminals/{tid}", func(w http.ResponseWriter, r *http.Request) {
		reply(w, nil, p.Kill(r.Context(), r.PathValue("id"), r.PathValue("tid")))
	})
	api.HandleFunc("GET /approvals", func(w http.ResponseWriter, r *http.Request) {
		out := []contract.Approval{}
		session := r.URL.Query().Get("session")
		err := p.Store.List("approvals", func(d func(any) error) error {
			var a contract.Approval
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
	api.HandleFunc("GET /usage", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		u, err := p.Usage(time.Now(), days, r.URL.Query().Get("by"))
		reply(w, &u, err)
	})
	api.HandleFunc("POST /approvals/{id}/{decision}", func(w http.ResponseWriter, r *http.Request) {
		// Accepted: the action and the outcome turn follow, and the stream tells how they went.
		a, err := p.Decide(r.PathValue("id"), r.PathValue("decision") == "approve", who(r.Context()))
		if err != nil {
			reply(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(&a)
	})

	want, _ := hex.DecodeString(tokenSHA256)
	bearer := http.NewServeMux()
	bearer.Handle("/", api)
	bearer.HandleFunc("POST /login-links", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Label string }
		var out struct {
			URL string `json:"url"`
		}
		reply(w, &out, read(r, &in, func() (err error) { out.URL, err = p.LoginLink(appHost, in.Label); return }))
	})
	app := http.NewServeMux()
	app.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("code") {
			p.login(w, r)
			return
		}
		serveUI(w, r)
	})
	app.HandleFunc("POST /api/logout", p.logout)
	app.Handle("/api/", p.signedIn(http.StripPrefix("/api", api)))
	app.HandleFunc("/", serveUI)
	preview := p.preview(appHost)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch strings.Split(r.Host, ":")[0] {
		case appHost:
			app.ServeHTTP(w, r)
		case apiHost:
			sum := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
			if len(want) == 0 || subtle.ConstantTimeCompare(sum[:], want) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			bearer.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), whoKey{}, "cli")))
		default:
			preview.ServeHTTP(w, r)
		}
	})
}

type routeKey struct{}

var frameAncestors = regexp.MustCompile(`(?i)\s*frame-ancestors[^;]*;?`)

// The preview is shown in the web UI's frame, and an app's own framing rules (Rails sends X-Frame-Options:
// SAMEORIGIN) would refuse it. The UI's host is allowed to frame it, and no other.
func frameable(res *http.Response, appHost string) {
	res.Header.Del("X-Frame-Options")
	csp := frameAncestors.ReplaceAllString(res.Header.Get("Content-Security-Policy"), "")
	csp = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(csp), ";"))
	if csp != "" {
		csp += "; "
	}
	res.Header.Set("Content-Security-Policy", csp+"frame-ancestors "+origin(appHost))
}

func (p *Plane) preview(appHost string) http.Handler {
	proxy := &httputil.ReverseProxy{
		ModifyResponse: func(res *http.Response) error {
			frameable(res, appHost)
			bridged(res)
			return nil
		},
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme, r.Out.URL.Host = "http", r.In.Host
			r.Out.Host = r.In.Host
			r.SetXForwarded()
			r.Out.Header.Set("X-Forwarded-Proto", "https")
			// A page is asked for uncompressed, so the bridge's script tag can be added to it.
			if document(r.In) {
				r.Out.Header.Del("Accept-Encoding")
			}
			// The app is reached through boxd: one port per actor, see box.ProxyHeader.
			r.Out.Header.Set(box.TokenHeader, p.derive("actor", r.In.Context().Value(routeKey{}).(Route).Actor))
			r.Out.Header.Set(box.ProxyHeader, strconv.Itoa(r.In.Context().Value(routeKey{}).(Route).Port))
		},
		Transport: &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return p.Sandboxes.Dial(ctx, ctx.Value(routeKey{}).(Route).Actor, box.Port)
		}},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.Split(r.Host, ":")[0]
		if r.URL.Path == bridgePath {
			serveBridge(w, appHost)
			return
		}
		if !p.gate(w, r, host) {
			return
		}
		var rt Route
		if err := p.Store.Get("routes", host, &rt); err != nil {
			http.NotFound(w, r)
			return
		}
		// A request open through here, a WebSocket included, is activity for as long as it lasts.
		release, err := p.enter(r.Context(), rt.Actor, rt.Tier)
		if err != nil {
			http.Error(w, "preview unavailable: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		defer release()
		if err := p.keyed(r.Context(), rt.Actor); err != nil {
			http.Error(w, "preview unavailable: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), routeKey{}, rt)))
	})
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
	case err == ErrNotFound:
		http.Error(w, err.Error(), http.StatusNotFound)
	case err != nil:
		code := http.StatusUnprocessableEntity
		switch err.(type) {
		case badRequest:
			code = http.StatusBadRequest
		case conflict:
			code = http.StatusConflict
		}
		http.Error(w, err.Error(), code)
	case v == nil:
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
}
