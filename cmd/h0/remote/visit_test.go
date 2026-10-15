package remote

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func gate(open bool) *httptest.Server {
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("token") == "t":
			http.SetCookie(w, &http.Cookie{Name: "h0_token", Value: "c", Path: "/"})
			http.Redirect(w, r, "/", http.StatusFound)
		case open, r.Header.Get("Cookie") == "h0_token=c":
			w.Write([]byte("<html><title>Rails Dummy</title></html>"))
		default:
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
	}))
}

func TestVisit(t *testing.T) {
	s := gate(false)
	defer s.Close()
	transport = s.Client().Transport
	defer func() { transport = nil }()
	host := strings.TrimPrefix(s.URL, "https://")
	var out bytes.Buffer
	if err := visit(host, s.URL+"/?token=t", &out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"no token   401", "link       302 Found, cookie true", `title "Rails Dummy"`} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in\n%s", want, out.String())
		}
	}
}

func TestVisitOpenGate(t *testing.T) {
	s := gate(true)
	defer s.Close()
	transport = s.Client().Transport
	defer func() { transport = nil }()
	err := visit(strings.TrimPrefix(s.URL, "https://"), s.URL+"/?token=t", &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "the gate is open") {
		t.Fatalf("got %v", err)
	}
}

// A link h0 printed is opened as it is; a host gets a link minted for it.
func TestTarget(t *testing.T) {
	link := "https://dummy-dev-preview.nvoi.to/?token=t"
	if h, l := target(link); h != "dummy-dev-preview.nvoi.to" || l != link {
		t.Fatalf("link: %s %s", h, l)
	}
	if h, l := target("dummy-dev-preview.nvoi.to"); h != "dummy-dev-preview.nvoi.to" || l != "" {
		t.Fatalf("host: %s %s", h, l)
	}
}
