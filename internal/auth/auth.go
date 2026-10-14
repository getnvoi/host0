// Who may use the plane: the CLI by its bearer token, a browser by a cookie a one-time link hands out.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/store"
)

// A browser signs in with a one-time link the CLI asks for; the link becomes a session cookie. Only hashes are
// stored, so the store holds nothing that opens a door.
type Auth struct{ Store store.Store }

const (
	sessionCookie = "hz_session"
	linkTTL       = 60 * time.Second
	sessionTTL    = 30 * 24 * time.Hour
)

type link struct {
	Label string    `json:"label"`
	Until time.Time `json:"until"`
}

type browser struct {
	ID    string    `json:"id"` // the digest of its cookie, which names its row
	Label string    `json:"label"`
	At    time.Time `json:"at"`
	Until time.Time `json:"until"`
}

func digest(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func random() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// A link to appHost that signs one browser in, once, within linkTTL.
func (a *Auth) LoginLink(appHost, label string) (string, error) {
	code := random()
	if err := a.Store.Put("links", digest(code), link{Label: label, Until: time.Now().Add(linkTTL)}); err != nil {
		return "", err
	}
	return "https://" + appHost + "/login?code=" + code, nil
}

// Trades the link's code for a cookie.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	id := digest(r.URL.Query().Get("code"))
	var l link
	if err := a.Store.Get("links", id, &l); err != nil || time.Now().After(l.Until) {
		http.Redirect(w, r, "/login?expired=1", http.StatusFound)
		return
	}
	// Used once: removed before the cookie is handed out.
	if err := a.Store.Delete("links", id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	token := random()
	now := time.Now()
	if err := a.Store.Put("browsers", digest(token), browser{ID: digest(token), Label: l.Label, At: now, Until: now.Add(sessionTTL)}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: true,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.Store.Delete("browsers", digest(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true})
	w.WriteHeader(http.StatusNoContent)
}

// The browsers signed in now.
func (a *Auth) Browsers() ([]Browser, error) {
	out := []Browser{}
	err := a.Store.List("browsers", func(d func(any) error) error {
		var b browser
		if err := d(&b); err != nil {
			return err
		}
		if time.Now().Before(b.Until) {
			out = append(out, Browser{Label: b.Label, At: b.At, Until: b.Until})
		}
		return nil
	})
	return out, err
}

// Signs out every browser under label, or every browser when label is empty; how many were signed in.
func (a *Auth) SignOut(label string) (int, error) {
	var ids, unnamed []string
	err := a.Store.List("browsers", func(d func(any) error) error {
		var b browser
		if err := d(&b); err != nil {
			return err
		}
		switch {
		case label != "" && b.Label != label, time.Now().After(b.Until):
		case b.ID == "":
			unnamed = append(unnamed, b.Label)
		default:
			ids = append(ids, b.ID)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := a.Store.Delete("browsers", id); err != nil {
			return 0, err
		}
	}
	if len(unnamed) > 0 {
		return len(ids), fmt.Errorf("signed out %d; browsers %v have no id yet and are given one on their next request", len(ids), unnamed)
	}
	if label != "" && len(ids) == 0 {
		return 0, store.ErrNotFound
	}
	return len(ids), nil
}

// The signed-in browser's own requests. A write must carry X-Requested-With: a header no cross-site form can set,
// and fetch from another origin cannot either without a preflight this server never answers.
func (a *Auth) SignedIn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		var b browser
		if err != nil || a.Store.Get("browsers", digest(c.Value), &b) != nil || time.Now().After(b.Until) {
			http.Error(w, "signed out", http.StatusUnauthorized)
			return
		}
		// A row without its id is given it here, so a sign-out can find it.
		if b.ID == "" {
			b.ID = digest(c.Value)
			if err := a.Store.Put("browsers", b.ID, b); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		if r.Method != http.MethodGet && r.Header.Get("X-Requested-With") != "hz" {
			http.Error(w, "missing X-Requested-With", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(through(r.Context(), ByCookie, b.Label)))
	})
}

type whoKey struct{}

type doorKey struct{}

// How a request came in: the CLI's bearer token, or a signed-in browser's cookie.
const (
	ByToken  = "bearer"
	ByCookie = "cookie"
)

func through(ctx context.Context, door, who string) context.Context {
	return context.WithValue(context.WithValue(ctx, doorKey{}, door), whoKey{}, who)
}

// The door the request came in by; empty when it came by neither.
func Door(ctx context.Context) string {
	s, _ := ctx.Value(doorKey{}).(string)
	return s
}

// Requests whose bearer token hashes to tokenSHA256 (hex), as cli; any other is refused. No hash refuses all.
func Bearer(tokenSHA256 string, next http.Handler) http.Handler {
	want, _ := hex.DecodeString(tokenSHA256)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sum := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
		if len(want) == 0 || subtle.ConstantTimeCompare(sum[:], want) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(through(r.Context(), ByToken, "cli")))
	})
}

// The labels of every browser signed in at some point, live or not.
func (a *Auth) People() ([]string, error) {
	var out []string
	err := a.Store.List("browsers", func(d func(any) error) error {
		var b browser
		if d(&b) == nil && b.Label != "" {
			out = append(out, b.Label)
		}
		return nil
	})
	return out, err
}

// Who is asking: the signed-in browser's label, or cli for the bearer token.
func Who(ctx context.Context) string {
	s, _ := ctx.Value(whoKey{}).(string)
	return s
}

// A browser signed in to the web UI, under the label its link was asked with.
type Browser struct {
	Label string    `json:"label"`
	At    time.Time `json:"at"`
	Until time.Time `json:"until"`
}
