package controlplane

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"regexp"

	"github.com/getnvoi/host0/controlplane/box"
)

var errBadTerminal = errors.New("bad terminal id")

var terminalID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type actorKey struct{}

// A WebSocket to the session's terminal tid, relayed to boxd. The browser reaches it with its cookie, so a request
// from a page on any other origin is refused.
func (p *Plane) terminal(appHost string) http.HandlerFunc {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme, r.Out.URL.Host, r.Out.Host = "http", "box", "box"
			r.Out.URL.Path, r.Out.URL.RawPath = "/pty/"+r.In.PathValue("tid"), ""
			r.Out.Header.Del("Cookie")
			r.Out.Header.Del("Authorization")
			r.Out.Header.Del("Origin")
			r.Out.Header.Set(box.TokenHeader, p.derive("actor", r.In.Context().Value(actorKey{}).(string)))
		},
		Transport: &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return p.Sandboxes.Dial(ctx, ctx.Value(actorKey{}).(string), box.Port)
		}},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && o != origin(appHost) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		if !terminalID.MatchString(r.PathValue("tid")) {
			http.Error(w, errBadTerminal.Error(), http.StatusBadRequest)
			return
		}
		s, env, err := p.awake(r.Context(), r.PathValue("id"))
		if err != nil {
			reply(w, nil, err)
			return
		}
		release, err := p.enter(r.Context(), s.Actor, env.Tier)
		if err != nil {
			reply(w, nil, err)
			return
		}
		defer release()
		if err := p.keyed(r.Context(), s.Actor); err != nil {
			reply(w, nil, err)
			return
		}
		proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, s.Actor)))
	}
}

func (p *Plane) Terminals(ctx context.Context, sid string) ([]box.Terminal, error) {
	s, _, err := p.awake(ctx, sid)
	if err != nil {
		return nil, err
	}
	return p.box(s.Actor).Terminals(ctx)
}

func (p *Plane) Kill(ctx context.Context, sid, tid string) error {
	if !terminalID.MatchString(tid) {
		return badRequest{errBadTerminal}
	}
	s, _, err := p.awake(ctx, sid)
	if err != nil {
		return err
	}
	return p.box(s.Actor).Kill(ctx, tid)
}
