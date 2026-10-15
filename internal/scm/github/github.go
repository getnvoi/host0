// scm.Forge on GitHub.
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/scm"
)

type Forge struct{}

var client = &http.Client{Timeout: 30 * time.Second}

// The API root; tests point it at a fake.
var root = "https://api.github.com"

var _ scm.Forge = Forge{}

// An open pull request for head is returned as it is.
func (Forge) PullRequest(ctx context.Context, token, repo, head, base, title, body string) (string, error) {
	if url, err := open(ctx, token, repo, head); err != nil || url != "" {
		return url, err
	}
	b, _ := json.Marshal(map[string]string{"title": title, "body": body, "head": head, "base": base})
	req, _ := http.NewRequestWithContext(ctx, "POST", root+"/repos/"+repo+"/pulls", bytes.NewReader(b))
	res, err := send(req, token)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var out struct {
		HTMLURL string `json:"html_url"`
		Message string `json:"message"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode == 422 && len(out.Errors) > 0 {
		return "", fmt.Errorf("github: %s", out.Errors[0].Message)
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("github %d: %s", res.StatusCode, out.Message)
	}
	return out.HTMLURL, nil
}

// The open pull request for head, or "".
func open(ctx context.Context, token, repo, head string) (string, error) {
	owner, _, _ := strings.Cut(repo, "/")
	q := url.Values{"head": {owner + ":" + head}, "state": {"open"}}
	req, _ := http.NewRequestWithContext(ctx, "GET", root+"/repos/"+repo+"/pulls?"+q.Encode(), nil)
	res, err := send(req, token)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("github %d listing pull requests", res.StatusCode)
	}
	var prs []struct {
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(res.Body).Decode(&prs); err != nil {
		return "", err
	}
	if len(prs) == 0 {
		return "", nil
	}
	return prs[0].HTMLURL, nil
}

// Every repository of every installation the token sees, a hundred a page.
func (Forge) Repositories(ctx context.Context, token string) ([]scm.Repository, error) {
	out := []scm.Repository{}
	for page := 1; ; page++ {
		var got struct {
			Installations []struct {
				ID int64 `json:"id"`
			} `json:"installations"`
		}
		if err := get(ctx, token, fmt.Sprintf("/user/installations?per_page=100&page=%d", page), &got); err != nil {
			return nil, err
		}
		for _, in := range got.Installations {
			rs, err := installation(ctx, token, in.ID)
			if err != nil {
				return nil, err
			}
			out = append(out, rs...)
		}
		if len(got.Installations) < 100 {
			return out, nil
		}
	}
}

func installation(ctx context.Context, token string, id int64) ([]scm.Repository, error) {
	var out []scm.Repository
	for page := 1; ; page++ {
		var got struct {
			Repositories []scm.Repository `json:"repositories"`
		}
		if err := get(ctx, token, fmt.Sprintf("/user/installations/%d/repositories?per_page=100&page=%d", id, page), &got); err != nil {
			return nil, err
		}
		out = append(out, got.Repositories...)
		if len(got.Repositories) < 100 {
			return out, nil
		}
	}
}

// GET path into out; a refusal carries GitHub's own message.
func get(ctx context.Context, token, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", root+path, nil)
	if err != nil {
		return err
	}
	res, err := send(req, token)
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

func send(req *http.Request, token string) (*http.Response, error) {
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	return client.Do(req)
}
