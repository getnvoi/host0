package main

import (
	"context"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/workspace"
)

type sessionID struct {
	ID string `path:"id" doc:"The session's id"`
}

type Log struct {
	ContentType string `header:"Content-Type"`
	Offset      int64  `header:"X-Offset" doc:"The offset after these bytes, to ask from next"`
	Body        []byte
}

func (p *plane) sessions(a huma.API) {
	ws := p.ws
	stream := op("stream", "GET", "/stream", "What happens, as server-sent events; Last-Event-ID resumes after it",
		hz{By: []string{"env seed"}, NoTool: true})
	stream.Responses = map[string]*huma.Response{"200": {Description: "One event per update, its id <epoch>-<n>",
		Content: map[string]*huma.MediaType{"text/event-stream": {
			Schema: a.OpenAPI().Components.Schemas.Schema(reflect.TypeFor[workspace.Update](), true, "")}}}}
	huma.Register(a, stream, func(context.Context, *struct {
		LastEventID string `header:"Last-Event-ID" doc:"The last id read"`
	}) (*huma.StreamResponse, error) {
		return &huma.StreamResponse{Body: func(ctx huma.Context) {
			r, w := humago.Unwrap(ctx)
			p.bus.ServeHTTP(w, r)
		}}, nil
	})
	huma.Register(a, op("session.ls", "GET", "/sessions", "Sessions, the most recently active first",
		hz{Output: "table", Columns: []string{"id", "env", "state", "queued", "by", "last", "title"}}),
		func(_ context.Context, in *struct {
			Env string `query:"env" doc:"Only this environment's"`
		}) (*body[[]workspace.Summary], error) {
			return answer(ws.Sessions(in.Env))
		})
	huma.Register(a, op("session.start", "POST", "/sessions", "Fork the environment's seed and run the prompt in it",
		hz{By: []string{"session start"}}),
		func(ctx context.Context, in *struct{ Body workspace.SessionInput }) (*body[workspace.Session], error) {
			return answer(ws.Start(in.Body.Env, in.Body.Agent, in.Body.Prompt, auth.Who(ctx)))
		})
	huma.Register(a, op("session.show", "GET", "/sessions/{id}", "The session and everything it printed",
		hz{Output: "fields", Columns: []string{"id", "env", "state", "branch", "preview", "turns", "by", "at", "title", "error"},
			By: []string{"session follow", "session start", "session say"}}),
		func(_ context.Context, in *sessionID) (*body[workspace.Session], error) {
			return answer(ws.Session(in.ID))
		})
	huma.Register(a, op("session.rm", "DELETE", "/sessions/{id}", "Remove the session and its sandbox; refused while it runs",
		hz{Output: "none"}),
		func(ctx context.Context, in *sessionID) (*struct{}, error) {
			return nil, problem(ws.DeleteSession(ctx, in.ID))
		})
	huma.Register(a, op("session.say", "POST", "/sessions/{id}/turns", "Send the session a message",
		hz{By: []string{"session say"}}),
		func(_ context.Context, in *struct {
			ID   string `path:"id" doc:"The session's id"`
			Body workspace.Message
		}) (*struct{}, error) {
			return nil, problem(ws.Say(in.ID, in.Body.Prompt, in.Body.To))
		})
	huma.Register(a, op("session.stop", "POST", "/sessions/{id}/stop", "Stop the running turn", hz{Output: "none"}),
		func(ctx context.Context, in *sessionID) (*struct{}, error) {
			return nil, problem(ws.Stop(ctx, in.ID))
		})
	huma.Register(a, op("session.suspend", "POST", "/sessions/{id}/suspend",
		"Snapshot the session and free its worker; a preview request or a turn resumes it", hz{Output: "none"}),
		func(ctx context.Context, in *sessionID) (*struct{}, error) {
			return nil, problem(ws.Suspend(ctx, in.ID))
		})
	huma.Register(a, op("session.queue.ls", "GET", "/sessions/{id}/queue", "Messages waiting for the session's turn to end",
		hz{Output: "table", By: []string{"session queue rm"}}),
		func(_ context.Context, in *sessionID) (*body[[]string], error) {
			return answer(ws.Queue(in.ID))
		})
	huma.Register(a, op("session.queue.rm", "DELETE", "/sessions/{id}/queue/{i}", "Withdraw queued message i, counted from 0",
		hz{By: []string{"session queue rm"}}),
		func(_ context.Context, in *struct {
			ID   string `path:"id" doc:"The session's id"`
			I    int    `path:"i" doc:"The message's place in the queue, from 0"`
			Body workspace.Withdrawal
		}) (*struct{}, error) {
			return nil, problem(ws.Unqueue(in.ID, in.I, in.Body.Text))
		})
	huma.Register(a, op("session.preview", "GET", "/sessions/{id}/preview", "Whether the session's app answers, waking it first",
		hz{Output: "fields"}),
		func(ctx context.Context, in *sessionID) (*body[workspace.PreviewStatus], error) {
			return answer(ws.PreviewStatus(ctx, in.ID))
		})
	huma.Register(a, op("session.changes", "GET", "/sessions/{id}/changes", "What the session changed against its environment's branch",
		hz{Output: "table", Field: "files", Columns: []string{"status", "added", "removed", "path", "old_path"}}),
		func(ctx context.Context, in *sessionID) (*body[workspace.Changes], error) {
			return answer(ws.Changes(ctx, in.ID))
		})
	huma.Register(a, op("session.log.ls", "GET", "/sessions/{id}/logs", "The session's logs: its setup and each service",
		hz{Output: "table", Columns: []string{"name", "kind"}}),
		func(_ context.Context, in *sessionID) (*body[[]workspace.Log], error) {
			return answer(ws.Logs(in.ID))
		})
	huma.Register(a, op("session.log.show", "GET", "/sessions/{id}/logs/{name}", "A log's bytes from offset; X-Offset is where the next read starts",
		hz{By: []string{"session log show"}}),
		func(ctx context.Context, in *struct {
			ID     string `path:"id" doc:"The session's id"`
			Name   string `path:"name" doc:"setup, or a service's name"`
			Offset int64  `query:"offset" doc:"Bytes already read"`
		}) (*Log, error) {
			b, next, err := ws.Log(ctx, in.ID, in.Name, in.Offset)
			if err != nil {
				return nil, problem(err)
			}
			return &Log{ContentType: "text/plain; charset=utf-8", Offset: next, Body: b}, nil
		})
	huma.Register(a, op("session.terminal.ls", "GET", "/sessions/{id}/terminals", "The session's terminals",
		hz{Output: "table", Columns: []string{"id", "command", "started", "clients"}}),
		func(ctx context.Context, in *sessionID) (*body[[]box.Terminal], error) {
			return answer(ws.Terminals(ctx, in.ID))
		})
	huma.Register(a, op("session.terminal.rm", "DELETE", "/sessions/{id}/terminals/{tid}", "End a terminal",
		hz{Output: "none"}),
		func(ctx context.Context, in *struct {
			ID  string `path:"id" doc:"The session's id"`
			TID string `path:"tid" doc:"The terminal's id"`
		}) (*struct{}, error) {
			return nil, problem(ws.Kill(ctx, in.ID, in.TID))
		})
	huma.Register(a, op("session.title", "PUT", "/sessions/{id}/title", "Name the session's task in a few words",
		hz{Output: "none", Tool: "auto"}),
		func(_ context.Context, in *struct {
			ID   string `path:"id" doc:"The session's id"`
			Body workspace.Title
		}) (*struct{}, error) {
			return nil, problem(ws.SetTitle(in.ID, in.Body.Title))
		})
	huma.Register(a, op("session.navigate", "POST", "/sessions/{id}/navigate", "Show a page of the session's app in its preview",
		hz{Output: "fields", Tool: "auto"}),
		func(_ context.Context, in *struct {
			ID   string `path:"id" doc:"The session's id"`
			Body workspace.Page
		}) (*body[workspace.Page], error) {
			return answer(ws.Navigate(in.ID, in.Body))
		})
	huma.Register(a, op("session.push", "POST", "/sessions/{id}/push", "Push the session's committed work to its branch on GitHub",
		hz{Output: "fields"}),
		func(ctx context.Context, in *sessionID) (*body[workspace.Pushed], error) {
			return answer(ws.Push(ctx, in.ID))
		})
	huma.Register(a, op("session.pr", "POST", "/sessions/{id}/pull-request",
		"Push the session's branch and open a pull request onto its environment's branch", hz{Output: "fields"}),
		func(ctx context.Context, in *struct {
			ID   string `path:"id" doc:"The session's id"`
			Body workspace.PullRequestInput
		}) (*body[workspace.PullRequest], error) {
			return answer(ws.OpenPullRequest(ctx, in.ID, in.Body))
		})
	logShow := a.OpenAPI().Paths["/sessions/{id}/logs/{name}"].Get.Responses["200"]
	logShow.Content = map[string]*huma.MediaType{"text/plain": {Schema: &huma.Schema{Type: "string"}}}
}
