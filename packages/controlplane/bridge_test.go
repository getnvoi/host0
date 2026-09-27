package controlplane

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

// Reads one byte at a time, so a tag split across reads is still found.
type trickle struct{ r io.Reader }

func (t trickle) Read(p []byte) (int, error) { return t.r.Read(p[:1]) }
func (trickle) Close() error                 { return nil }

func inject(t *testing.T, body string) string {
	req, _ := http.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Accept", "text/html")
	res := &http.Response{Request: req, StatusCode: 200, Header: http.Header{"Content-Type": {"text/html; charset=utf-8"},
		"Content-Length": {"99"}}, Body: trickle{strings.NewReader(body)}}
	bridged(res)
	if res.Header.Get("Content-Length") != "" {
		t.Fatal("length kept")
	}
	out, _ := io.ReadAll(res.Body)
	return string(out)
}

func TestBridged(t *testing.T) {
	tag := `<script src="/__hz/bridge.js"></script>`
	if got := inject(t, `<!doctype html><HEAD lang="en"><title>x</title></head><body>hi</body>`); got !=
		`<!doctype html><HEAD lang="en">`+tag+`<title>x</title></head><body>hi</body>` {
		t.Fatalf("after head: %q", got)
	}
	if got := inject(t, `<header>not it</header>`); got != tag+`<header>not it</header>` {
		t.Fatalf("no head: %q", got)
	}

	req, _ := http.NewRequest("GET", "http://x/app.js", nil)
	res := &http.Response{Request: req, Header: http.Header{"Content-Type": {"text/javascript"}}, Body: io.NopCloser(strings.NewReader("js"))}
	bridged(res)
	if b, _ := io.ReadAll(res.Body); string(b) != "js" {
		t.Fatal("a script was rewritten")
	}
}

func TestBridgeScript(t *testing.T) {
	s := bridgeScript("app-dev.host0.dev")
	if !strings.Contains(s, `var O = "https://app-dev.host0.dev"`) || !strings.Contains(s, "hz:url") || !strings.Contains(s, "hz:ping") {
		t.Fatalf("script: %s", s)
	}
}
