package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A sign-in, from the hub's redirect to GitHub to the app's exchange, lasts this long; so does its one-time code.
const signInFor = 10 * time.Minute

func random() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func digest(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// base64url of sha256(verifier), as PKCE's S256 says.
func s256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

type userKey struct{}

// The signed-in user of a request, from its device token.
func (h *hub) bearer(r *http.Request) (User, error) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	var u User
	if !ok || token == "" {
		return u, said(http.StatusUnauthorized, "Sign in with GitHub: this request carries no device token.")
	}
	err := h.DB.Joins("JOIN devices ON devices.user_id = users.id").Where("devices.hash = ?", digest(token)).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return u, said(http.StatusUnauthorized, "Sign in with GitHub again: this device's token is signed out.")
	}
	return u, err
}

func userOf(ctx context.Context) User { return ctx.Value(userKey{}).(User) }

type Me struct {
	Login     string  `json:"login"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

type found struct {
	Status   int
	Location string `header:"Location"`
}

func (h *hub) callbackURL() string { return h.URL + "/v1/auth/github/callback" }

func (h *hub) auth(a huma.API) {
	huma.Register(a, huma.Operation{OperationID: "auth-github", Method: "GET", Path: "/v1/auth/github", DefaultStatus: 302,
		Summary: "Sign in with GitHub: the browser goes to GitHub, then back to the app with a one-time code bound to challenge"},
		func(_ context.Context, in *struct {
			Challenge string `query:"challenge" required:"true" doc:"base64url of sha256(verifier)"`
			Method    string `query:"method" required:"true" enum:"S256"`
			State     string `query:"state" required:"true" doc:"The app's; it comes back with the code"`
			Redirect  string `query:"redirect" required:"true" doc:"The app's address: the one the hub is configured with"`
		}) (*found, error) {
			if in.Redirect != h.Redirect {
				return nil, said(http.StatusBadRequest, "This hub signs in to %s, not %s.", h.Redirect, in.Redirect)
			}
			s := SignIn{State: random(), Challenge: in.Challenge, AppState: in.State, Expires: time.Now().Add(signInFor)}
			if err := h.DB.Create(&s).Error; err != nil {
				return nil, fail(err)
			}
			return &found{302, h.GitHub.authorize(h.callbackURL(), s.State)}, nil
		})
	huma.Register(a, huma.Operation{OperationID: "auth-github-callback", Method: "GET", Path: "/v1/auth/github/callback",
		DefaultStatus: 302, Summary: "Where GitHub sends the browser back; it goes on to the app"},
		func(ctx context.Context, in *struct {
			Code        string `query:"code"`
			State       string `query:"state"`
			Error       string `query:"error"`
			Description string `query:"error_description"`
		}) (*found, error) {
			var s SignIn
			err := h.DB.Transaction(func(tx *gorm.DB) error {
				if err := tx.Where("state = ?", in.State).First(&s).Error; err != nil {
					return err
				}
				return tx.Delete(&s).Error
			})
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fail(err)
			}
			if s.ID == 0 || time.Now().After(s.Expires) {
				return nil, said(http.StatusBadRequest, "This sign-in is not the hub's, or it is over ten minutes old: sign in again from the app.")
			}
			back := func(q url.Values) *found {
				q.Set("state", s.AppState)
				return &found{302, h.Redirect + "?" + q.Encode()}
			}
			if in.Error != "" {
				return back(url.Values{"error": {firstOf(in.Description, in.Error)}}), nil
			}
			code, err := h.signIn(ctx, in.Code, s.Challenge)
			if err != nil {
				return back(url.Values{"error": {err.Error()}}), nil
			}
			return back(url.Values{"code": {code}}), nil
		})
	huma.Register(a, huma.Operation{OperationID: "auth-token", Method: "POST", Path: "/v1/auth/token", DefaultStatus: 200,
		Summary: "Trade a one-time code and the verifier of its challenge for a device token"},
		func(_ context.Context, in *struct {
			Body struct {
				Code     string `json:"code"`
				Verifier string `json:"verifier"`
			}
		}) (*body[struct {
			Token string `json:"token"`
		}], error) {
			token, err := h.trade(in.Body.Code, in.Body.Verifier)
			out := &body[struct {
				Token string `json:"token"`
			}]{}
			out.Body.Token = token
			return out, err
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "auth-signout", Method: "DELETE", Path: "/v1/auth/token",
		DefaultStatus: 204, Summary: "Sign this device out: its token stops working"}),
		func(ctx context.Context, in *struct {
			Authorization string `header:"Authorization"`
		}) (*struct{}, error) {
			token := strings.TrimPrefix(in.Authorization, "Bearer ")
			return nil, fail(h.DB.Where("hash = ?", digest(token)).Delete(&Device{}).Error)
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "me", Method: "GET", Path: "/v1/me", Summary: "Who is signed in"}),
		func(ctx context.Context, _ *struct{}) (*body[Me], error) {
			u := userOf(ctx)
			me := Me{Login: u.Login, Name: u.Name}
			if u.AvatarURL != "" {
				me.AvatarURL = &u.AvatarURL
			}
			return &body[Me]{me}, nil
		})
}

func firstOf(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}

// GitHub's code to the user, whose token goes to the plane of each workspace with one; a one-time code for the app.
func (h *hub) signIn(ctx context.Context, code, challenge string) (string, error) {
	token, err := h.GitHub.exchange(ctx, code, h.callbackURL())
	if err != nil {
		return "", err
	}
	gu, err := h.GitHub.user(ctx, token)
	if err != nil {
		return "", err
	}
	email, err := h.GitHub.email(ctx, token)
	if err != nil {
		return "", err
	}
	u := User{GitHubID: gu.ID, Login: gu.Login, Name: gu.Name, AvatarURL: gu.AvatarURL, Email: email}
	if err := h.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "git_hub_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"login", "name", "avatar_url", "email"})}).Create(&u).Error; err != nil {
		return "", err
	}
	if err := h.DB.Where("git_hub_id = ?", gu.ID).First(&u).Error; err != nil {
		return "", err
	}
	var spaces []Workspace
	if err := h.DB.Where("user_id = ?", u.ID).Find(&spaces).Error; err != nil {
		return "", err
	}
	for _, w := range spaces {
		if w.Token == "" {
			continue
		}
		if err := h.handGitHub(ctx, w, token); err != nil {
			return "", err
		}
	}
	one := random()
	if err := h.DB.Create(&Code{Hash: digest(one), UserID: u.ID, Challenge: challenge, Expires: time.Now().Add(signInFor)}).Error; err != nil {
		return "", err
	}
	return one, nil
}

// The code is spent by its first trade, whether the verifier matches or not.
func (h *hub) trade(code, verifier string) (string, error) {
	gone := said(http.StatusBadRequest, "This sign-in code was used, it expired, or it is not this app's.")
	var c Code
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("hash = ? AND used = ? AND expires > ?", digest(code), false, time.Now()).First(&c).Error; err != nil {
			return err
		}
		return tx.Model(&c).Update("used", true).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", gone
	}
	if err != nil {
		return "", fail(err)
	}
	if subtle.ConstantTimeCompare([]byte(s256(verifier)), []byte(c.Challenge)) != 1 {
		return "", gone
	}
	token := random()
	if err := h.DB.Create(&Device{UserID: c.UserID, Hash: digest(token)}).Error; err != nil {
		return "", fail(err)
	}
	return token, nil
}
