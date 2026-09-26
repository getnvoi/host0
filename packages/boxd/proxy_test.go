package boxd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProxy(t *testing.T) {
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(TokenHeader) != "" || r.Header.Get(ProxyHeader) != "" {
			t.Errorf("box headers reached the app: %v", r.Header)
		}
		io.WriteString(w, r.Host+" "+r.URL.Path)
	}))
	defer app.Close()
	port := strings.TrimPrefix(app.URL, "http://127.0.0.1:")
	box := httptest.NewServer((&Server{Token: "t", Root: t.TempDir()}).Handler())
	defer box.Close()

	get := func(headers map[string]string) (int, string) {
		req, _ := http.NewRequest("GET", box.URL+"/health", nil)
		req.Host = "x-dev-preview.nvoi.to"
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	if code, body := get(map[string]string{TokenHeader: "t", ProxyHeader: port}); code != 200 || body != "x-dev-preview.nvoi.to /health" {
		t.Fatalf("proxied: %d %q", code, body)
	}
	if code, _ := get(map[string]string{ProxyHeader: port}); code != 401 {
		t.Fatalf("without token: %d", code)
	}
	if code, _ := get(map[string]string{TokenHeader: "t", ProxyHeader: "0"}); code != 400 {
		t.Fatalf("bad port: %d", code)
	}
}

func TestProxyForwarded(t *testing.T) {
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, r.Header.Get("X-Forwarded-Proto")+" "+r.Header.Get("X-Forwarded-Host")+" "+r.Header.Get("Forwarded"))
	}))
	defer app.Close()
	box := httptest.NewServer((&Server{Token: "t", Root: t.TempDir()}).Handler())
	defer box.Close()
	req, _ := http.NewRequest("GET", box.URL+"/", nil)
	req.Header.Set(TokenHeader, "t")
	req.Header.Set(ProxyHeader, strings.TrimPrefix(app.URL, "http://127.0.0.1:"))
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "x-dev-preview.nvoi.to")
	req.Header.Set("Forwarded", "proto=https;host=x-dev-preview.nvoi.to")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if want := "https x-dev-preview.nvoi.to proto=https;host=x-dev-preview.nvoi.to"; string(b) != want {
		t.Fatalf("got %q", b)
	}
}
