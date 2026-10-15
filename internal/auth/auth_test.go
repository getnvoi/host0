package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/shared/seal"
)

// Auth on a database in a fresh file, migrated.
func newAuth(t *testing.T) *Auth {
	t.Helper()
	gdb, err := db.Open(filepath.Join(t.TempDir(), "h0.db"), seal.Mint())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if s, err := gdb.DB(); err == nil {
			s.Close()
		}
	})
	if err := db.Migrate(gdb); err != nil {
		t.Fatal(err)
	}
	return &Auth{DB: gdb}
}

// The cookie the link's code is traded for, and where the trade redirected to.
func login(t *testing.T, a *Auth, url string) (*http.Cookie, string) {
	t.Helper()
	w := httptest.NewRecorder()
	a.Login(w, httptest.NewRequest("GET", strings.TrimPrefix(url, "https://app.x"), nil))
	cs := w.Result().Cookies()
	if len(cs) == 0 {
		return nil, w.Header().Get("Location")
	}
	return cs[0], w.Header().Get("Location")
}

func TestLinkSignsInOnce(t *testing.T) {
	a := newAuth(t)
	url, err := a.LoginLink("app.x", "ben")
	if err != nil {
		t.Fatal(err)
	}
	c, to := login(t, a, url)
	if c == nil || to != "/" {
		t.Fatalf("signed in: %v, to %s", c, to)
	}
	if c2, to := login(t, a, url); c2 != nil || to != "/login?expired=1" {
		t.Fatalf("a link used twice: %v, to %s", c2, to)
	}
	var rows []db.SignIn
	if err := a.DB.Find(&rows).Error; err != nil || len(rows) != 1 || rows[0].Kind != browser || rows[0].Digest == c.Value {
		t.Fatalf("rows %+v %v", rows, err)
	}

	var got string
	h := a.SignedIn(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = Who(r.Context()) }))
	r := httptest.NewRequest("GET", "/usage", nil)
	r.AddCookie(c)
	h.ServeHTTP(httptest.NewRecorder(), r)
	if got != "ben" {
		t.Fatalf("who %q", got)
	}
}

func TestExpiredLink(t *testing.T) {
	a := newAuth(t)
	url, err := a.LoginLink("app.x", "ben")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.DB.Model(&db.SignIn{}).Where("kind = ?", link).Update("expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if c, to := login(t, a, url); c != nil || to != "/login?expired=1" {
		t.Fatalf("an expired link: %v, to %s", c, to)
	}
	if _, err := a.LoginLink("app.x", "ann"); err != nil {
		t.Fatal(err)
	}
	var n int64
	if a.DB.Model(&db.SignIn{}).Count(&n); n != 1 {
		t.Fatalf("%d rows: the expired link outlives the next one asked for", n)
	}
}

func TestBrowsersAndSignOut(t *testing.T) {
	a := newAuth(t)
	for _, l := range []string{"ben", "ben", "ann"} {
		url, err := a.LoginLink("app.x", l)
		if err != nil {
			t.Fatal(err)
		}
		login(t, a, url)
	}
	if err := a.DB.Create(&db.SignIn{Digest: "old", Kind: browser, Label: "carol", ExpiresAt: time.Now().Add(-time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	bs, err := a.Browsers()
	if err != nil || len(bs) != 3 || bs[0].Label != "ben" || bs[0].At.IsZero() || !bs[0].Until.After(bs[0].At) {
		t.Fatalf("browsers %+v %v", bs, err)
	}
	if people, err := a.People(); err != nil || !slices.Equal(people, []string{"ann", "ben", "carol"}) {
		t.Fatalf("people %v %v", people, err)
	}
	if _, err := a.SignOut("carol"); !errors.As(err, new(NotFound)) {
		t.Fatalf("signed out an expired browser: %v", err)
	}
	if n, err := a.SignOut("ben"); n != 2 || err != nil {
		t.Fatalf("ben: %d %v", n, err)
	}
	if n, err := a.SignOut(""); n != 1 || err != nil {
		t.Fatalf("all: %d %v", n, err)
	}
	if bs, _ := a.Browsers(); len(bs) != 0 {
		t.Fatalf("still signed in: %+v", bs)
	}
}

func TestSignedOutCookie(t *testing.T) {
	a := newAuth(t)
	h := a.SignedIn(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("served") }))
	r := httptest.NewRequest("GET", "/usage", nil)
	r.AddCookie(&http.Cookie{Name: sessionCookie, Value: "nothing"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("%d", w.Code)
	}
}
