package controlplane

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/shared/contract"
)

// A sandbox whose every port is one boxd stand-in.
type boxed struct {
	Sandboxes
	addr string
}

func (b boxed) State(context.Context, string) (string, error) { return "running", nil }
func (b boxed) Dial(ctx context.Context, _ string, _ int) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "tcp", b.addr)
}

func withBox(t *testing.T, boxd http.HandlerFunc) (*Plane, http.Handler) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		boxd(w, r)
	}))
	t.Cleanup(srv.Close)
	p, h := handler(t)
	p.Sandboxes, p.BoxToken = boxed{addr: srv.Listener.Addr().String()}, "box"
	p.Store.Put("environments", "web", contract.Environment{Name: "web", Branch: "main",
		Services: []contract.Service{{Name: "rails"}, {Name: "worker"}}})
	p.Store.Put("credentials", "default", testCreds)
	p.Store.Put("seeds", "web", contract.Seed{Env: "web", Run: "seed-1"})
	p.Store.Put("sessions", "s1", contract.Session{ID: "s1", Env: "web", Actor: "wt-s1"})
	return p, h
}

var bearer = map[string]string{"Authorization": "Bearer cli-token"}

func TestLogs(t *testing.T) {
	var asked []string
	_, h := withBox(t, func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.Query().Get("path"))
		if r.URL.Path != "/tail" {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Query().Get("path"), "worker.log") {
			http.Error(w, "no such file", http.StatusNotFound)
			return
		}
		w.Header().Set("X-Offset", "9")
		w.Write([]byte("installed"))
	})
	res := call(h, "GET", "api-dev.nvoi.to", "/sessions/s1/logs", "", bearer)
	if got := strings.TrimSpace(res.Body.String()); got != `[{"name":"setup","kind":"setup"},{"name":"rails","kind":"service"},{"name":"worker","kind":"service"}]` {
		t.Fatalf("list %d %s", res.Code, got)
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/sessions/s1/logs/setup?offset=0", "", bearer)
	if res.Body.String() != "installed" || res.Header().Get("X-Offset") != "9" {
		t.Fatalf("setup %d %q %v", res.Code, res.Body.String(), res.Header())
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/sessions/s1/logs/worker?offset=4", "", bearer)
	if res.Code != 200 || res.Body.Len() != 0 || res.Header().Get("X-Offset") != "4" {
		t.Fatalf("unwritten log %d %q %v", res.Code, res.Body.String(), res.Header())
	}
	if res = call(h, "GET", "api-dev.nvoi.to", "/sessions/s1/logs/..%2Fetc?offset=0", "", bearer); res.Code != 404 {
		t.Fatalf("unknown log %d", res.Code)
	}
	if want := []string{"/workspace/.hz/runs/seed-1/log", "/workspace/.hz/logs/worker.log"}; !reflect.DeepEqual(asked, want) {
		t.Fatalf("asked boxd for %v", asked)
	}
}

func TestTerminalOrigin(t *testing.T) {
	var got http.Header
	p, h := withBox(t, func(w http.ResponseWriter, r *http.Request) {
		got = r.Header
		w.Write([]byte(r.URL.String()))
	})
	p.Store.Put("browsers", digest("tok"), browser{Until: time.Now().Add(time.Hour)})
	jar := map[string]string{"Cookie": sessionCookie + "=tok"}
	jar["Origin"] = "https://evil.example"
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/sessions/s1/terminals/main", "", jar); res.Code != 403 {
		t.Fatalf("foreign origin: %d", res.Code)
	}
	jar["Origin"] = "https://app-dev.nvoi.to"
	res := call(h, "GET", "app-dev.nvoi.to", "/api/sessions/s1/terminals/main?cols=80&rows=24", "", jar)
	if res.Code != 200 || res.Body.String() != "/pty/main?cols=80&rows=24" {
		t.Fatalf("own origin: %d %q", res.Code, res.Body.String())
	}
	if got.Get("Cookie") != "" || got.Get("X-Box-Token") != p.derive("actor", "wt-s1") {
		t.Fatalf("relayed headers %v", got)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/sessions/s1/terminals/main", "", bearer); res.Code != 200 {
		t.Fatalf("bearer: %d", res.Code)
	}
}

func TestTerminalUpgrade(t *testing.T) {
	_, h := withBox(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "websocket" {
			http.Error(w, "no upgrade", http.StatusBadRequest)
			return
		}
		conn, rw, _ := w.(http.Hijacker).Hijack()
		defer conn.Close()
		rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		rw.Flush()
		b := make([]byte, 4)
		n, _ := rw.Read(b)
		conn.Write(b[:n])
	})
	srv := httptest.NewServer(h)
	defer srv.Close()
	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	conn.Write([]byte("GET /sessions/s1/terminals/main HTTP/1.1\r\nHost: api-dev.nvoi.to\r\nAuthorization: Bearer cli-token\r\n" +
		"Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n"))
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, nil)
	if err != nil || res.StatusCode != 101 {
		t.Fatalf("upgrade: %v %v", res, err)
	}
	conn.Write([]byte("ping"))
	b := make([]byte, 4)
	if _, err := io.ReadFull(br, b); err != nil || string(b) != "ping" {
		t.Fatalf("echo %q %v", b, err)
	}
}
