package box

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"regexp"
)

var ErrBadTerminal = errors.New("bad terminal id")

var TerminalID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type actorKey struct{}

// ctx naming the actor a Relay request goes to.
func ForActor(ctx context.Context, actor string) context.Context {
	return context.WithValue(ctx, actorKey{}, actor)
}

// A WebSocket to boxd's terminal named by the request's tid, in the actor ForActor names. The request's own
// credentials stay behind; token gives the actor's.
func Relay(dial func(ctx context.Context, actor string) (net.Conn, error), token func(actor string) string) http.Handler {
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme, r.Out.URL.Host, r.Out.Host = "http", "box", "box"
			r.Out.URL.Path, r.Out.URL.RawPath = "/pty/"+r.In.PathValue("tid"), ""
			r.Out.Header.Del("Cookie")
			r.Out.Header.Del("Authorization")
			r.Out.Header.Del("Origin")
			r.Out.Header.Set(TokenHeader, token(r.In.Context().Value(actorKey{}).(string)))
		},
		Transport: &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dial(ctx, ctx.Value(actorKey{}).(string))
		}},
	}
}
