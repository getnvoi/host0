package workspace

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/db"
)

type Pushed struct {
	Branch string `json:"branch"`
}

type PullRequest struct {
	URL string `json:"url"`
}

type PullRequestInput struct {
	Title string `json:"title" doc:"The pull request's title"`
	Body  string `json:"body,omitempty" doc:"What it changes"`
}

type Title struct {
	Title string `json:"title" doc:"The task in a few words"`
}

// A page of the session's app, which the UI shows in its preview.
type Page struct {
	Path string `json:"path" doc:"Its path, from / (/health)"`
}

// Pushes the session's committed work to its branch on GitHub. The token stays in git's environment, never on disk.
func (ws *Workspace) Push(ctx context.Context, sid string) (Pushed, error) {
	s, env, err := ws.Awake(ctx, sid)
	if err != nil {
		return Pushed{}, err
	}
	_, creds, err := ws.env(s.Env)
	if err != nil {
		return Pushed{}, err
	}
	release, err := ws.Workers.Enter(ctx, s.Actor, env.Tier)
	if err != nil {
		return Pushed{}, err
	}
	defer release()
	// The credential goes in git's environment config, not its arguments, which any process in the box can list.
	script := `git push --no-verify -q -f origin "HEAD:refs/heads/$BRANCH"`
	auth := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:"+creds.GitHub))
	run := "push-" + id()
	started(ctx, run)
	if err := ws.box(s.Actor).Must(ctx, run, box.Run{Argv: []string{"sh", "-c", script}, Dir: App,
		Env: map[string]string{"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraheader", "GIT_CONFIG_VALUE_0": auth,
			"BRANCH": s.Branch, "GIT_TERMINAL_PROMPT": "0"}}, nil); err != nil {
		return Pushed{}, fmt.Errorf("push %s: %w", s.Branch, err)
	}
	return Pushed{Branch: s.Branch}, nil
}

// Pushes the session's branch and opens a pull request from it onto its environment's branch.
func (ws *Workspace) OpenPullRequest(ctx context.Context, sid string, in PullRequestInput) (PullRequest, error) {
	if strings.TrimSpace(in.Title) == "" {
		return PullRequest{}, Invalid{fmt.Errorf("a pull request needs a title")}
	}
	if _, err := ws.Push(ctx, sid); err != nil {
		return PullRequest{}, err
	}
	s, err := ws.load(sid)
	if err != nil {
		return PullRequest{}, err
	}
	env, creds, err := ws.env(s.Env)
	if err != nil {
		return PullRequest{}, err
	}
	url, err := ws.Forge.PullRequest(ctx, creds.GitHub, env.Repo, s.Branch, env.Branch, in.Title, in.Body)
	if err != nil {
		return PullRequest{}, err
	}
	return PullRequest{URL: url}, nil
}

// Names the session. Only the title's column is written: a turn holding the session never writes it back.
func (ws *Workspace) SetTitle(sid, title string) error {
	unlock := lock(sid)
	defer unlock()
	if err := ws.DB.Model(&db.Session{}).Where("public_id = ?", sid).Update("title", title).Error; err != nil {
		return err
	}
	s, err := ws.load(sid)
	if err != nil {
		return err
	}
	ws.announce(&s)
	return nil
}

// The page the UI is to show; the UI moves its preview on seeing the call, so this only checks the path.
func (ws *Workspace) Navigate(sid string, p Page) (Page, error) {
	if _, err := ws.load(sid); err != nil {
		return Page{}, err
	}
	if !strings.HasPrefix(p.Path, "/") {
		return Page{}, Invalid{fmt.Errorf("a path starting with / is needed")}
	}
	return p, nil
}
