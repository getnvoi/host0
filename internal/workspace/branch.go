package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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

// Fetches the environment's branch on the plane and writes it into the actor as a bundle: the token never enters it.
func (ws *Workspace) checkout(ctx context.Context, bx box.Client, token string, env Environment, line func(string)) error {
	dir, err := os.MkdirTemp("", "h0-checkout-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "checkout.bundle")
	if err := ws.Forge.Bundle(ctx, token, env.Repo, env.Branch, path, line); err != nil {
		return err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	line(fmt.Sprintf("writing %d bytes to %s", len(b), checkoutBundle))
	if err := bx.Write(ctx, checkoutBundle, 0o600, b); err != nil {
		return fmt.Errorf("writing the checkout into the sandbox: %w", err)
	}
	return nil
}

// Pushes the session's committed work to its branch on GitHub: the sandbox bundles HEAD, the plane pushes it.
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
	bx := ws.box(s.Actor)
	run := "push-" + id()
	started(ctx, run)
	script := fmt.Sprintf("rm -f %[1]s && git bundle create -q %[1]s HEAD", pushBundle)
	if err := bx.Must(ctx, run, box.Run{Argv: sh(script), Dir: App}, nil); err != nil {
		return Pushed{}, fmt.Errorf("bundling %s: %w", s.Branch, err)
	}
	f, err := os.CreateTemp("", "h0-push-*.bundle")
	if err != nil {
		return Pushed{}, err
	}
	defer os.Remove(f.Name())
	err = bx.Read(ctx, pushBundle, f)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return Pushed{}, fmt.Errorf("reading the bundle of %s: %w", s.Branch, err)
	}
	if err := ws.Forge.Push(ctx, creds.GitHub, env.Repo, f.Name(), s.Branch); err != nil {
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
