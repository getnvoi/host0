package main

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/workspace"
)

type approvalID struct {
	ID string `path:"id" doc:"The approval's id"`
}

func (p *plane) approvals(a huma.API) {
	ws := p.ws
	huma.Register(a, op("approval.ls", "GET", "/approvals", "Actions waiting for a decision",
		hz{Output: "table", Columns: []string{"id", "session", "tool", "input"}, By: []string{"session follow", "approval approve", "approval deny"}}),
		func(_ context.Context, in *struct {
			Session string `query:"session" doc:"Only this session's"`
		}) (*body[[]workspace.Approval], error) {
			return answer(ws.Approvals(in.Session, "pending"))
		})
	huma.Register(a, op("approval.show", "GET", "/approvals/{id}", "One approval in full, decided or not",
		hz{By: []string{"approval show"}}),
		func(_ context.Context, in *approvalID) (*body[workspace.Approval], error) {
			return answer(ws.Approval(in.ID))
		})
	for _, d := range []string{"approve", "deny"} {
		o := op("approval."+d, "POST", "/approvals/{id}/"+d,
			map[string]string{"approve": "Carry the action out", "deny": "Refuse the action"}[d]+
				"; the outcome turn follows, and the stream tells how it went", hz{By: []string{"approval " + d}})
		o.DefaultStatus = http.StatusAccepted
		huma.Register(a, o, func(ctx context.Context, in *approvalID) (*body[workspace.Approval], error) {
			return answer(ws.Decide(in.ID, d == "approve", auth.Who(ctx)))
		})
	}
}
