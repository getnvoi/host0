package stream

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The first data line the stream sends a reader whose last id is last.
func first(t *testing.T, b *Broker, last string) string {
	t.Helper()
	srv := httptest.NewServer(b)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	req.Header.Set("Last-Event-ID", last)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		if line, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
			return line
		}
	}
	t.Fatalf("nothing sent after Last-Event-ID %s", last)
	return ""
}

func TestResumes(t *testing.T) {
	b := New(map[string]string{"kind": "reset"})
	b.Publish(map[string]int{"n": 1})
	b.Publish(map[string]int{"n": 2})
	if got := first(t, b, b.id(1)); got != `{"n":2}` {
		t.Fatalf("resumed with %s, want only the second", got)
	}
}

// An id from a previous run of the plane, even one with a number this run has reached, resets the reader.
func TestResetsAcrossRestarts(t *testing.T) {
	b := New(map[string]string{"kind": "reset"})
	for i := 0; i < 3; i++ {
		b.Publish(map[string]int{"n": i})
	}
	for _, last := range []string{"2", "0-2", "other-2"} {
		if got := first(t, b, last); got != `{"kind":"reset"}` {
			t.Fatalf("Last-Event-ID %q: got %s, want a reset", last, got)
		}
	}
}
