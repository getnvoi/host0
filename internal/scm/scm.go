// Source control: what the plane asks of the forge a repository lives on. github implements it.
package scm

import "context"

type Forge interface {
	PullRequest(ctx context.Context, token, repo, head, base, title, body string) (string, error)
}
