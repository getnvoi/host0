package tools

import "context"

type PullRequest struct{}

func (PullRequest) Name() string { return "create_pull_request" }
func (PullRequest) Description() string {
	return "Push this branch and open a pull request for it. Commit first."
}
func (PullRequest) Args() map[string]string {
	return map[string]string{"title": "string", "body": "string"}
}
func (PullRequest) Policy() string { return "" }

func (PullRequest) Do(ctx context.Context, c *Call, in Input) string {
	if err := push(ctx, c); err != nil {
		return "create_pull_request: push failed: " + err.Error()
	}
	url, err := c.Forge.PullRequest(ctx, c.Token, c.Repo, c.Branch, c.Base, in.Title, in.Body)
	if err != nil {
		return "create_pull_request: failed: " + err.Error()
	}
	return "create_pull_request: opened " + url
}
