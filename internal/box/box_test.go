package box

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Read follows the offsets boxd answers until a read comes back empty.
func TestRead(t *testing.T) {
	const file = "a bundle's bytes"
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tail" || r.URL.Query().Get("path") != "/workspace/.h0/push.bundle" {
			http.NotFound(w, r)
			return
		}
		at, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		end := min(at+3, len(file))
		w.Header().Set("X-Offset", strconv.Itoa(end))
		io.WriteString(w, file[at:end])
	})
	var b strings.Builder
	if err := c.Read(context.Background(), "/workspace/.h0/push.bundle", &b); err != nil || b.String() != file {
		t.Fatalf("read %q, err %v", b.String(), err)
	}
	if err := c.Read(context.Background(), "/elsewhere", &b); !errors.Is(err, ErrMissing) {
		t.Fatalf("a missing file: %v", err)
	}
}

func client(t *testing.T, h http.HandlerFunc) Client {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	addr := strings.TrimPrefix(srv.URL, "http://")
	return Client{Token: "t", Dial: func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	}}
}

func TestExec(t *testing.T) {
	var puts atomic.Int32
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "PUT" && puts.Add(1) == 1:
			http.Error(w, "busy", http.StatusServiceUnavailable)
		case r.Method == "PUT":
			w.WriteHeader(http.StatusCreated)
		case r.URL.Query().Get("offset") == "0":
			io.WriteString(w, "one\ntw")
		default:
			w.Header().Set("X-Exit", "3")
			io.WriteString(w, "o")
		}
	})
	var lines []string
	code, err := c.Exec(context.Background(), "a", Run{Argv: []string{"x"}}, 0, func(l string) { lines = append(lines, l) })
	if err != nil || code != 3 || strings.Join(lines, "|") != "one|two" || puts.Load() != 2 {
		t.Fatalf("code %d err %v lines %q puts %d", code, err, lines, puts.Load())
	}
}

func TestExecBadExit(t *testing.T) {
	for _, exit := range []string{"", "x"} {
		c := client(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header()["X-Exit"] = []string{exit}
		})
		if _, err := c.Exec(context.Background(), "a", Run{}, 0, func(string) {}); err == nil {
			t.Fatalf("exit %q taken as a code", exit)
		}
	}
}

func TestExecRefused(t *testing.T) {
	var puts atomic.Int32
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		puts.Add(1)
		http.Error(w, "argv required", http.StatusBadRequest)
	})
	if _, err := c.Exec(context.Background(), "a", Run{Argv: []string{"x"}}, 0, func(string) {}); err == nil || puts.Load() != 1 {
		t.Fatalf("err %v after %d tries", err, puts.Load())
	}
}

func TestExecIdle(t *testing.T) {
	var polls atomic.Int32
	c := client(t, func(w http.ResponseWriter, r *http.Request) { polls.Add(1) })
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if _, err := c.Exec(ctx, "a", Run{}, 0, func(string) {}); err == nil || polls.Load() > 3 {
		t.Fatalf("err %v after %d polls", err, polls.Load())
	}
}

func TestRekeyOnUnauthorized(t *testing.T) {
	current := "env"
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(TokenHeader) != current {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method == "PUT" && r.URL.Path == "/token" {
			b, _ := io.ReadAll(r.Body)
			current = string(b)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	c.Token, c.Seed = "own", "env"
	if err := c.Check(context.Background()); err != nil || current != "own" {
		t.Fatalf("check: %v, boxd on %q", err, current)
	}
	c.Seed = ""
	current = "env"
	if err := c.Check(context.Background()); err == nil {
		t.Fatal("no seed, yet it passed")
	}
}
