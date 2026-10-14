package tools

import (
	"context"
	"encoding/base64"

	"github.com/getnvoi/host0/internal/box"
)

type PushBranch struct{}

func (PushBranch) Name() string            { return "push_branch" }
func (PushBranch) Description() string     { return "Push the committed work on this branch to GitHub." }
func (PushBranch) Args() map[string]string { return nil }
func (PushBranch) Policy() string          { return "" }

func (PushBranch) Do(ctx context.Context, c *Call, _ Input) string {
	if err := push(ctx, c); err != nil {
		return "push_branch: failed: " + err.Error()
	}
	return "push_branch: pushed " + c.Branch
}

// Pushes the branch. It never waits on a hook or a credential prompt.
func push(ctx context.Context, c *Call) error {
	// The credential goes in git's environment config, not its arguments, which any process in the box can list.
	script := `git push --no-verify -q -f origin "HEAD:refs/heads/$BRANCH"`
	auth := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:"+c.Token))
	run := "push-" + id()
	if c.Started != nil {
		c.Started(run)
	}
	return c.Box.Must(ctx, run, box.Run{Argv: []string{"sh", "-c", script}, Dir: c.Dir,
		Env: map[string]string{"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraheader", "GIT_CONFIG_VALUE_0": auth,
			"BRANCH": c.Branch, "GIT_TERMINAL_PROMPT": "0"}}, nil)
}
