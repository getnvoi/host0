// controlplane.Forge on GitHub.
package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/getnvoi/host0/controlplane"
)

type GitHub struct{}

var client = &http.Client{Timeout: 30 * time.Second}

// The API root; tests point it at a fake.
var root = "https://api.github.com"

var _ controlplane.Forge = GitHub{}

// An open pull request for head is returned as it is.
func (GitHub) PullRequest(ctx context.Context, token, repo, head, base, title, body string) (string, error) {
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

func send(req *http.Request, token string) (*http.Response, error) {
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	return client.Do(req)
}
