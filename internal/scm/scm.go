// Source control: what the plane asks of the forge a repository lives on. github implements it.
package scm

import "context"

// The token goes to the forge from the plane alone: a sandbox receives a bundle and hands one back.
type Forge interface {
	PullRequest(ctx context.Context, token, repo, head, base, title, body string) (string, error)
	// Writes branch of repo, with its history, as a git bundle at out; each line git prints goes to line.
	Bundle(ctx context.Context, token, repo, branch, out string, line func(string)) error
	// Points branch of repo at the HEAD the bundle at path holds, replacing what it pointed at.
	Push(ctx context.Context, token, repo, bundle, branch string) error
	// The repositories the GitHub App's installations visible to token reach.
	Repositories(ctx context.Context, token string) ([]Repository, error)
}

type Repository struct {
	FullName      string `json:"full_name"`
	DefaultBranch string `json:"default_branch"`
	Private       bool   `json:"private"`
}
