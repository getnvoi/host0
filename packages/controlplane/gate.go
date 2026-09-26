package controlplane

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// The preview gate: a token is { aud: "preview", host, exp }, HS256, bound to one preview host. Verified offline,
// before anything is woken; it leaves the URL for a cookie at once and never reaches the app.
const (
	gateCookie   = "nvoi_token"
	gateAudience = "preview"
	gateSkew     = 60 * time.Second
)

var b64 = base64.RawURLEncoding

type gateClaims struct {
	Aud  string `json:"aud"`
	Host string `json:"host"`
	Exp  int64  `json:"exp"`
}

func (p *Plane) gateKey() []byte {
	sum := sha256.Sum256([]byte("nvoi preview gate\x00" + p.BoxToken))
	return sum[:]
}

// A link to host that opens for ttl.
func (p *Plane) PreviewURL(host string, ttl time.Duration) string {
	head := b64.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body, _ := json.Marshal(gateClaims{Aud: gateAudience, Host: host, Exp: time.Now().Add(ttl).Unix()})
	msg := head + "." + b64.EncodeToString(body)
	mac := hmac.New(sha256.New, p.gateKey())
	mac.Write([]byte(msg))
	return origin(host) + "/?token=" + msg + "." + b64.EncodeToString(mac.Sum(nil))
}

var errExpired = errors.New("expired")

func (p *Plane) verify(token string) (gateClaims, error) {
	var c gateClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return c, errors.New("malformed")
	}
	var head struct{ Alg string }
	raw, err := b64.DecodeString(parts[0])
	if err != nil || json.Unmarshal(raw, &head) != nil || head.Alg != "HS256" {
		return c, errors.New("not HS256")
	}
	mac := hmac.New(sha256.New, p.gateKey())
	mac.Write([]byte(parts[0] + "." + parts[1]))
	sig, err := b64.DecodeString(parts[2])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return c, errors.New("bad signature")
	}
	if raw, err = b64.DecodeString(parts[1]); err != nil || json.Unmarshal(raw, &c) != nil || c.Aud != gateAudience || c.Exp == 0 {
		return c, errors.New("not a preview token")
	}
	if time.Now().Add(-gateSkew).Unix() > c.Exp {
		return c, errExpired
	}
	return c, nil
}

// Nil when the request may pass; otherwise it has been answered. Strips our token and cookie from what is proxied.
func (p *Plane) gate(w http.ResponseWriter, r *http.Request, host string) bool {
	query := r.URL.Query().Get("token")
	cookie, _ := r.Cookie(gateCookie)
	var presented string
	stale := false
	for _, t := range []string{query, r.Header.Get("x-nvoi-token"), value(cookie)} {
		if t == "" {
			continue
		}
		c, err := p.verify(t)
		if err == errExpired {
			stale = true
			continue
		}
		if err == nil && c.Host == host {
			presented = t
			break
		}
	}
	if presented == "" {
		if document(r) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			msg := "This preview needs a link from nvoi."
			if stale {
				msg = "This preview link has expired. Ask nvoi for a new one."
			}
			w.Write([]byte("<!doctype html><title>" + host + "</title><p style=\"font:16px system-ui;margin:3rem\">" + msg + "</p>"))
		} else {
			http.Error(w, "401 Unauthorized", http.StatusUnauthorized)
		}
		return false
	}
	if presented == query && document(r) {
		clean := *r.URL
		q := clean.Query()
		q.Del("token")
		clean.RawQuery = q.Encode()
		// SameSite=None and Partitioned: a preview is shown in a cross-site iframe, and assets need the cookie there.
		w.Header().Set("Set-Cookie", gateCookie+"="+presented+"; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=86400")
		http.Redirect(w, r, clean.RequestURI(), http.StatusFound)
		return false
	}
	if presented == query {
		q := r.URL.Query()
		q.Del("token")
		r.URL.RawQuery = q.Encode()
	}
	r.Header.Del("x-nvoi-token")
	stripCookie(r, gateCookie)
	return true
}

func value(c *http.Cookie) string {
	if c == nil {
		return ""
	}
	return c.Value
}

func document(r *http.Request) bool {
	return r.Method == http.MethodGet &&
		(r.Header.Get("Sec-Fetch-Dest") == "document" || strings.Contains(r.Header.Get("Accept"), "text/html"))
}

func stripCookie(r *http.Request, name string) {
	var keep []string
	for _, c := range r.Cookies() {
		if c.Name != name {
			keep = append(keep, c.Name+"="+c.Value)
		}
	}
	r.Header.Del("Cookie")
	if len(keep) > 0 {
		r.Header.Set("Cookie", strings.Join(keep, "; "))
	}
}
