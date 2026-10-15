package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// The GitHub App that signs people in. Web and API are github.com and api.github.com; tests point them at a fake.
type githubApp struct {
	ClientID, Secret, Slug string
	Web, API               string
}

var outbound = &http.Client{Timeout: 30 * time.Second}

func (g githubApp) authorize(redirectURI, state string) string {
	return g.Web + "/login/oauth/authorize?" + url.Values{"client_id": {g.ClientID}, "redirect_uri": {redirectURI},
		"state": {state}}.Encode()
}

func (g githubApp) installURL() string {
	return "https://github.com/apps/" + g.Slug + "/installations/new"
}

// The user token for code. The app's user tokens do not expire: expiry is opted out on the app.
func (g githubApp) exchange(ctx context.Context, code, redirectURI string) (string, error) {
	form := url.Values{"client_id": {g.ClientID}, "client_secret": {g.Secret}, "code": {code}, "redirect_uri": {redirectURI}}
	req, err := http.NewRequestWithContext(ctx, "POST", g.Web+"/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := outbound.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	// GitHub answers a refused code 200 with error and error_description.
	var out struct {
		AccessToken      string `json:"access_token"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("github %d on the code exchange, and its answer does not read: %w", res.StatusCode, err)
	}
	if out.Error != "" {
		return "", fmt.Errorf("github refused the code: %s (%s)", out.ErrorDescription, out.Error)
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("github %d on the code exchange gave no token", res.StatusCode)
	}
	return out.AccessToken, nil
}

type githubUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

type githubEmail struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func (g githubApp) user(ctx context.Context, token string) (githubUser, error) {
	var u githubUser
	return u, g.get(ctx, token, "/user", &u)
}

// The primary verified address; "" when there is none.
func (g githubApp) email(ctx context.Context, token string) (string, error) {
	var es []githubEmail
	if err := g.get(ctx, token, "/user/emails", &es); err != nil {
		return "", err
	}
	for _, e := range es {
		if e.Primary && e.Verified {
			return e.Email, nil
		}
	}
	return "", nil
}

func (g githubApp) get(ctx context.Context, token, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", g.API+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := outbound.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var e struct {
			Message string `json:"message"`
		}
		if err := json.NewDecoder(res.Body).Decode(&e); err != nil {
			return fmt.Errorf("github %d on %s, and its answer does not read: %w", res.StatusCode, path, err)
		}
		return fmt.Errorf("github %d on %s: %s", res.StatusCode, path, e.Message)
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("github %s: %w", path, err)
	}
	return nil
}
