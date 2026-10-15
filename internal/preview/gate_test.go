package preview

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGate(t *testing.T) {
	g := Gate{Secret: "secret"}
	host := "a-dev-preview.nvoi.to"
	link := g.URL(host, time.Hour)
	token := link[strings.Index(link, "token=")+6:]
	pass := func(r *http.Request) (bool, *httptest.ResponseRecorder) {
		w := httptest.NewRecorder()
		return g.Pass(w, r, host), w
	}

	if ok, w := pass(httptest.NewRequest("GET", "/", nil)); ok || w.Code != 401 {
		t.Fatalf("no token: %v %d", ok, w.Code)
	}
	doc := httptest.NewRequest("GET", "/x?token="+token+"&keep=1", nil)
	doc.Header.Set("Accept", "text/html")
	if ok, w := pass(doc); ok || w.Code != 302 || !strings.Contains(w.Header().Get("Set-Cookie"), "SameSite=None; Partitioned") ||
		w.Header().Get("Location") != "/x?keep=1" {
		t.Fatalf("document with token: %v %d %v", ok, w.Code, w.Header())
	}
	asset := httptest.NewRequest("GET", "/app.css", nil)
	asset.Header.Set("Cookie", "h0_token="+token+"; theirs=1")
	if ok, _ := pass(asset); !ok || asset.Header.Get("Cookie") != "theirs=1" {
		t.Fatalf("cookie: %v %q", ok, asset.Header.Get("Cookie"))
	}
	other := httptest.NewRequest("GET", "/", nil)
	other.Header.Set("x-h0-token", token)
	if ok, _ := (Gate{Secret: "secret"}).Pass(httptest.NewRecorder(), other, "b-dev-preview.nvoi.to"), false; ok {
		t.Fatal("token for another host passed")
	}
	expired := (Gate{Secret: "secret"}).URL(host, -time.Hour)
	if _, err := g.verify(expired[strings.Index(expired, "token=")+6:]); err != errExpired {
		t.Fatalf("expired: %v", err)
	}
}
