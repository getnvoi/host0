// Who may use the plane: the CLI by its bearer token, a browser by a cookie a one-time link hands out.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
)

// A browser signs in with a one-time link the CLI asks for; the link becomes a session cookie. Each is a SignIn row
// holding the digest of its token, so the database holds nothing that opens a door.
type Auth struct{ DB *gorm.DB }

const (
	sessionCookie = "hz_session"
	linkTTL       = 60 * time.Second
	sessionTTL    = 30 * 24 * time.Hour
)

// SignIn kinds.
const (
	link    = "link"
	browser = "browser"
)

// No browser is signed in under the label asked for.
type NotFound struct{ error }

func digest(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func random() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// A link to appHost that signs one browser in, once, within linkTTL. Links already expired are removed.
func (a *Auth) LoginLink(appHost, label string) (string, error) {
	now := time.Now()
	if err := a.DB.Where("kind = ? AND expires_at < ?", link, now).Delete(&db.SignIn{}).Error; err != nil {
		return "", err
	}
	code := random()
	if err := a.DB.Create(&db.SignIn{Digest: digest(code), Kind: link, Label: label, ExpiresAt: now.Add(linkTTL)}).Error; err != nil {
		return "", err
	}
	return "https://" + appHost + "/login?code=" + code, nil
}

// Trades the link's code for a cookie.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	var l db.SignIn
	err := a.DB.Where("digest = ? AND kind = ?", digest(r.URL.Query().Get("code")), link).First(&l).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && time.Now().After(l.ExpiresAt) {
		http.Redirect(w, r, "/login?expired=1", http.StatusFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Used once: removed before the cookie is handed out, and only by the request that removed it.
	del := a.DB.Delete(&l)
	if del.Error != nil {
		http.Error(w, del.Error.Error(), http.StatusInternalServerError)
		return
	}
	if del.RowsAffected == 0 {
		http.Redirect(w, r, "/login?expired=1", http.StatusFound)
		return
	}
	token := random()
	if err := a.DB.Create(&db.SignIn{Digest: digest(token), Kind: browser, Label: l.Label,
		ExpiresAt: time.Now().Add(sessionTTL)}).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: true,
		SameSite: http.SameSiteLaxMode, MaxAge: int(sessionTTL.Seconds())})
	http.Redirect(w, r, "/", http.StatusFound)
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if err := a.DB.Where("digest = ? AND kind = ?", digest(c.Value), browser).Delete(&db.SignIn{}).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true})
	w.WriteHeader(http.StatusNoContent)
}

// The browsers signed in now, the first signed in first.
func (a *Auth) Browsers() ([]Browser, error) {
	var rows []db.SignIn
	if err := a.DB.Where("kind = ? AND expires_at > ?", browser, time.Now()).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]Browser, len(rows))
	for i, b := range rows {
		out[i] = Browser{Label: b.Label, At: b.CreatedAt, Until: b.ExpiresAt}
	}
	return out, nil
}

// Signs out every browser under label, or every browser when label is empty; how many were signed in.
func (a *Auth) SignOut(label string) (int, error) {
	q := a.DB.Where("kind = ? AND expires_at > ?", browser, time.Now())
	if label != "" {
		q = q.Where("label = ?", label)
	}
	res := q.Delete(&db.SignIn{})
	if res.Error != nil {
		return 0, res.Error
	}
	if label != "" && res.RowsAffected == 0 {
		return 0, NotFound{fmt.Errorf("no browser is signed in as %s: hz browsers lists them", label)}
	}
	return int(res.RowsAffected), nil
}

// The signed-in browser's own requests. A write must carry X-Requested-With: a header no cross-site form can set,
// and fetch from another origin cannot either without a preflight this server never answers.
func (a *Auth) SignedIn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			http.Error(w, "signed out", http.StatusUnauthorized)
			return
		}
		var b db.SignIn
		err = a.DB.Where("digest = ? AND kind = ? AND expires_at > ?", digest(c.Value), browser, time.Now()).First(&b).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			http.Error(w, "signed out", http.StatusUnauthorized)
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
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

// How a request came in: the CLI's bearer token, a signed-in browser's cookie, or a session's agent calling a tool.
const (
	ByToken  = "bearer"
	ByCookie = "cookie"
	ByAgent  = "agent"
)

func through(ctx context.Context, door, who string) context.Context {
	return context.WithValue(context.WithValue(ctx, doorKey{}, door), whoKey{}, who)
}

// A request a session's agent makes through one of its tools, served in-process: it never crosses the network.
func AsAgent(ctx context.Context, agent, sid string) context.Context {
	return through(ctx, ByAgent, fmt.Sprintf("agent %s, session %s", agent, sid))
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

// The labels of every browser still holding a row, live or not.
func (a *Auth) People() ([]string, error) {
	var out []string
	err := a.DB.Model(&db.SignIn{}).Where("kind = ? AND label != ''", browser).Distinct().Order("label").Pluck("label", &out).Error
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
	At    time.Time `json:"at" doc:"When it signed in"`
	Until time.Time `json:"until" doc:"When its cookie expires"`
}
