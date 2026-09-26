package controlplane

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/nvoi/shared/contract"
)

func handler(t *testing.T) (*Plane, http.Handler) {
	sum := sha256.Sum256([]byte("cli-token"))
	p := &Plane{Store: newStore(), Cluster: "dev", Zone: "nvoi.to"}
	return p, p.Handler("api-dev.nvoi.to", "app-dev.nvoi.to", hex.EncodeToString(sum[:]))
}

func call(h http.Handler, method, host, target string, body string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Host = host
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestLogin(t *testing.T) {
	_, h := handler(t)
	res := call(h, "POST", "api-dev.nvoi.to", "/login-links", `{"label":"laptop"}`, map[string]string{"Authorization": "Bearer cli-token"})
	var out struct{ URL string }
	json.NewDecoder(res.Body).Decode(&out)
	if res.Code != 200 || !strings.HasPrefix(out.URL, "https://app-dev.nvoi.to/login?code=") {
		t.Fatalf("link: %d %q", res.Code, out.URL)
	}
	path := strings.TrimPrefix(out.URL, "https://app-dev.nvoi.to")

	first := call(h, "GET", "app-dev.nvoi.to", path, "", nil)
	cookie := first.Result().Cookies()
	if first.Code != 302 || len(cookie) != 1 || !cookie[0].HttpOnly || !cookie[0].Secure {
		t.Fatalf("first use: %d %v", first.Code, cookie)
	}
	if again := call(h, "GET", "app-dev.nvoi.to", path, "", nil); again.Header().Get("Location") != "/login?expired=1" {
		t.Fatalf("second use of the same link was not refused: %d %v", again.Code, again.Header())
	}

	jar := map[string]string{"Cookie": cookie[0].Name + "=" + cookie[0].Value}
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/me", "", jar); res.Code != 200 {
		t.Fatalf("me with cookie: %d", res.Code)
	}
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/me", "", nil); res.Code != 401 {
		t.Fatalf("me without cookie: %d", res.Code)
	}
	if res := call(h, "POST", "app-dev.nvoi.to", "/api/sessions", `{}`, jar); res.Code != 403 {
		t.Fatalf("write without X-Requested-With: %d", res.Code)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/me", "", jar); res.Code != 401 {
		t.Fatalf("the API host took a browser cookie: %d", res.Code)
	}
}

func TestStreamResumes(t *testing.T) {
	bus = newBroker()
	p, _ := handler(t)
	s := &contract.Session{ID: "a", State: "running", Events: []contract.Event{{Kind: "prompt", Content: "hi"}}}
	p.save(s)
	s.Events = append(s.Events, contract.Event{Kind: "message", Content: "hello"})
	p.save(s)

	srv := httptest.NewServer(http.HandlerFunc(p.stream))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	req.Header.Set("Last-Event-ID", bus.id(1))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var u contract.Update
		json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &u)
		if u.From != 1 || len(u.Events) != 1 || u.Events[0].Content != "hello" {
			t.Fatalf("resumed with %+v, want only the second event", u)
		}
		return
	}
	t.Fatal("nothing replayed after Last-Event-ID 1")
}

// An id from a previous run of the plane, even one with a number this run has reached, resets the reader.
func TestStreamResetsAcrossRestarts(t *testing.T) {
	bus = newBroker()
	p, _ := handler(t)
	for i := 0; i < 3; i++ {
		p.save(&contract.Session{ID: "a", State: "running"})
	}
	srv := httptest.NewServer(http.HandlerFunc(p.stream))
	defer srv.Close()
	for _, last := range []string{"2", "0-2", "other-2"} {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
		req.Header.Set("Last-Event-ID", last)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		sc := bufio.NewScanner(res.Body)
		var got contract.Update
		for sc.Scan() {
			if line, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
				json.Unmarshal([]byte(line), &got)
				break
			}
		}
		res.Body.Close()
		cancel()
		if got.Kind != "reset" {
			t.Fatalf("Last-Event-ID %q: got %+v, want a reset", last, got)
		}
	}
}

func TestUpdateSendsFromZero(t *testing.T) {
	b, _ := json.Marshal(contract.Update{Kind: "session", Events: []contract.Event{{Kind: "prompt"}}})
	if !strings.Contains(string(b), `"from":0`) {
		t.Fatalf("from 0 left out: %s", b)
	}
}

func TestNewSessionHasAnEventList(t *testing.T) {
	p, _ := handler(t)
	s := &contract.Session{ID: "n", State: "forking"}
	p.save(s)
	var got map[string]any
	b, _ := json.Marshal(s)
	json.Unmarshal(b, &got)
	if _, ok := got["events"].([]any); !ok {
		t.Fatalf("events is %v, want a list", got["events"])
	}
}

func TestFrameable(t *testing.T) {
	res := &http.Response{Header: http.Header{}}
	res.Header.Set("X-Frame-Options", "SAMEORIGIN")
	res.Header.Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
	frameable(res, "app-dev.nvoi.to")
	if res.Header.Get("X-Frame-Options") != "" {
		t.Fatal("X-Frame-Options kept")
	}
	if got := res.Header.Get("Content-Security-Policy"); got != "default-src 'self'; frame-ancestors https://app-dev.nvoi.to" {
		t.Fatalf("csp %q", got)
	}
}

func TestSayWhileRunning(t *testing.T) {
	p, _ := handler(t)
	p.Store.Put("sessions", "s1", contract.Session{ID: "s1", State: "running"})
	done := make(chan error, 1)
	go func() { done <- p.Say("s1", "next", "") }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Say blocked: the queue lock is taken twice")
	}
	if q := p.Queue("s1"); len(q) != 1 || q[0] != "next" {
		t.Fatalf("queue: %v", q)
	}
}
