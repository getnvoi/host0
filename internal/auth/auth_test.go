package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/store"
)

// Records kept as JSON, as the real store keeps them.
type memory map[string][]byte

func (m memory) Get(kind, id string, v any) error {
	b, ok := m[kind+"/"+id]
	if !ok {
		return store.ErrNotFound
	}
	return json.Unmarshal(b, v)
}

func (m memory) Put(kind, id string, v any) error {
	b, err := json.Marshal(v)
	m[kind+"/"+id] = b
	return err
}

func (m memory) Delete(kind, id string) error { delete(m, kind+"/"+id); return nil }

func (m memory) List(string, func(func(any) error) error) error { return nil }

func TestWho(t *testing.T) {
	a := &Auth{Store: memory{}}
	a.Store.Put("browsers", digest("t"), browser{Label: "ben", Until: time.Now().Add(time.Hour)})
	var got string
	h := a.SignedIn(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = Who(r.Context()) }))
	r := httptest.NewRequest("GET", "/usage", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: "t"})
	h.ServeHTTP(httptest.NewRecorder(), r)
	if got != "ben" {
		t.Fatalf("who %q", got)
	}
}
