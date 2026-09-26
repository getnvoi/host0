package boxd

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func dial(t *testing.T, ctx context.Context, srv *httptest.Server, path string) *websocket.Conn {
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+path,
		&websocket.DialOptions{HTTPHeader: http.Header{TokenHeader: {"t"}}})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// Reads until the output so far contains want, or an exit message arrives.
func until(t *testing.T, ctx context.Context, c *websocket.Conn, want string) (string, int) {
	var out strings.Builder
	for !strings.Contains(out.String(), want) {
		typ, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %q, got %q: %v", want, out.String(), err)
		}
		if typ == websocket.MessageText {
			var m struct {
				Type string
				Code int
			}
			json.Unmarshal(b, &m)
			if m.Type == "exit" {
				return out.String(), m.Code
			}
			continue
		}
		out.Write(b)
	}
	return out.String(), -1
}

func TestTerminal(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("no /bin/sh")
	}
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	a := dial(t, ctx, srv, "/pty/one?cols=80&rows=24&dir="+t.TempDir())
	a.Write(ctx, websocket.MessageBinary, []byte("echo h''i\n"))
	until(t, ctx, a, "hi")
	if err := a.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","cols":100,"rows":40}`)); err != nil {
		t.Fatal(err)
	}
	a.Close(websocket.StatusNormalClosure, "")

	req, _ := http.NewRequest("GET", srv.URL+"/pty", nil)
	req.Header.Set(TokenHeader, "t")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var list []Terminal
	json.NewDecoder(res.Body).Decode(&list)
	if len(list) != 1 || list[0].ID != "one" {
		t.Fatalf("list after detach: %+v", list)
	}

	b := dial(t, ctx, srv, "/pty/one")
	if _, b1, err := b.Read(ctx); err != nil || !strings.Contains(string(b1), "hi") {
		t.Fatalf("scrollback %q %v", b1, err)
	}
	b.Write(ctx, websocket.MessageBinary, []byte("exit 3\n"))
	if _, code := until(t, ctx, b, "\x00never"); code != 3 {
		t.Fatalf("exit code %d", code)
	}
	if _, _, err := b.Read(ctx); websocket.CloseStatus(err) != websocket.StatusNormalClosure {
		t.Fatalf("close: %v", err)
	}
	if _, ok := s.ptys.Load("one"); ok {
		t.Fatal("terminal kept after its shell exited")
	}
}

func TestExecAndTail(t *testing.T) {
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	do := func(method, path, body string) (*http.Response, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set(TokenHeader, "t")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var b strings.Builder
		buf := make([]byte, 4096)
		for {
			n, err := res.Body.Read(buf)
			b.Write(buf[:n])
			if err != nil {
				break
			}
		}
		return res, b.String()
	}
	res, out := do("POST", "/exec", `{"argv":["sh","-c","echo out; echo err >&2; exit 4"]}`)
	if res.Header.Get("X-Exit") != "4" || out != "out\nerr\n" {
		t.Fatalf("exec: %q exit %q", out, res.Header.Get("X-Exit"))
	}
	path := t.TempDir() + "/log"
	os.WriteFile(path, []byte("hello world"), 0o644)
	res, out = do("GET", "/tail?path="+path+"&offset=6", "")
	if out != "world" || res.Header.Get("X-Offset") != "11" {
		t.Fatalf("tail: %q offset %q", out, res.Header.Get("X-Offset"))
	}
	if res, _ = do("GET", "/tail?path="+path+"x", ""); res.StatusCode != 404 {
		t.Fatalf("missing file: %d", res.StatusCode)
	}
}

func TestTerminalKill(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("no /bin/sh")
	}
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := dial(t, ctx, srv, "/pty/two")
	c.Write(ctx, websocket.MessageBinary, []byte("echo re''ady\n"))
	until(t, ctx, c, "ready")
	req, _ := http.NewRequest("DELETE", srv.URL+"/pty/two", nil)
	req.Header.Set(TokenHeader, "t")
	if res, err := http.DefaultClient.Do(req); err != nil || res.StatusCode != 204 {
		t.Fatalf("delete: %v %v", res, err)
	}
	if _, code := until(t, ctx, c, "\x00never"); code == -1 {
		t.Fatal("no exit message after delete")
	}
}

func TestTerminalDead(t *testing.T) {
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// A terminal still listed whose shell has ended, as an attach racing the exit finds it.
	d := &term{id: "gone", clients: map[*client]struct{}{}}
	d.exit(5)
	s.ptys.Store("gone", d)
	c := dial(t, ctx, srv, "/pty/gone")
	if _, code := until(t, ctx, c, "\x00never"); code != 5 {
		t.Fatalf("exit code %d", code)
	}
	if _, _, err := c.Read(ctx); websocket.CloseStatus(err) != websocket.StatusNormalClosure {
		t.Fatalf("close: %v", err)
	}
	if len(d.clients) != 0 {
		t.Fatal("client kept on a dead terminal")
	}
}

func TestTerminalFailed(t *testing.T) {
	t.Setenv("PATH", "")
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := dial(t, ctx, srv, "/pty/none")
	_, _, err := c.Read(ctx)
	var ce websocket.CloseError
	if !errors.As(err, &ce) || ce.Code != failed || !strings.HasPrefix(ce.Reason, "terminal did not start") {
		t.Fatalf("close: %v", err)
	}
	if _, ok := s.ptys.Load("none"); ok {
		t.Fatal("failed terminal listed")
	}
}
