package boxd

import (
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"sync"
)

// ProxyHeader names a port on the actor's loopback. A request carrying it is relayed there instead of served by
// boxd, so every connection into the actor targets boxd's port. Substrate's router keeps the target port per
// pooled upstream, and a second port on the same actor can receive traffic meant for the first.
const ProxyHeader = "X-Box-Proxy"

var proxies sync.Map

func proxy(port int) http.Handler {
	if p, ok := proxies.Load(port); ok {
		return p.(http.Handler)
	}
	target := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	p := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Scheme, r.Out.URL.Host = "http", target
			r.Out.Host = r.In.Host
			r.Out.Header.Del(TokenHeader)
			r.Out.Header.Del(ProxyHeader)
			// Rewrite strips the forwarding headers; the edge's are passed on as they came.
			for _, h := range []string{"X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "Forwarded"} {
				if v, ok := r.In.Header[h]; ok {
					r.Out.Header[h] = v
				}
			}
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			http.Error(w, "nothing answers on port "+strconv.Itoa(port)+": "+err.Error(), http.StatusBadGateway)
		},
	}
	actual, _ := proxies.LoadOrStore(port, http.Handler(p))
	return actual.(http.Handler)
}

func proxied(r *http.Request) (http.Handler, bool) {
	v := r.Header.Get(ProxyHeader)
	if v == "" {
		return nil, false
	}
	port, err := strconv.Atoi(v)
	if err != nil || port < 1 || port > 65535 {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "bad "+ProxyHeader, http.StatusBadRequest)
		}), true
	}
	return proxy(port), true
}
