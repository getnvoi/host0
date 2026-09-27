package controlplane

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"
)

// A browser signs in with a one-time link the CLI asks for; the link becomes a session cookie. Only hashes are
// stored, so the store holds nothing that opens a door.
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
func (p *Plane) LoginLink(appHost, label string) (string, error) {
	code := random()
	if err := p.Store.Put("links", digest(code), link{Label: label, Until: time.Now().Add(linkTTL)}); err != nil {
		return "", err
	}
	return origin(appHost) + "/login?code=" + code, nil
}

func (p *Plane) login(w http.ResponseWriter, r *http.Request) {
	id := digest(r.URL.Query().Get("code"))
	var l link
	if err := p.Store.Get("links", id, &l); err != nil || time.Now().After(l.Until) {
		http.Redirect(w, r, "/login?expired=1", http.StatusFound)
		return
	}
	// Used once: removed before the cookie is handed out.
	if err := p.Store.Delete("links", id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	token := random()
	now := time.Now()
	if err := p.Store.Put("browsers", digest(token), browser{Label: l.Label, At: now, Until: now.Add(sessionTTL)}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: true,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (p *Plane) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		p.Store.Delete("browsers", digest(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true})
	w.WriteHeader(http.StatusNoContent)
}

// The signed-in browser's own requests. A write must carry X-Requested-With: a header no cross-site form can set,
// and fetch from another origin cannot either without a preflight this server never answers.
func (p *Plane) signedIn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		var b browser
		if err != nil || p.Store.Get("browsers", digest(c.Value), &b) != nil || time.Now().After(b.Until) {
			http.Error(w, "signed out", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("X-Requested-With") != "hz" {
			http.Error(w, "missing X-Requested-With", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), whoKey{}, b.Label)))
	})
}

type whoKey struct{}

// Who is asking: the signed-in browser's label, or cli for the bearer token.
func who(ctx context.Context) string {
	s, _ := ctx.Value(whoKey{}).(string)
	return s
}
