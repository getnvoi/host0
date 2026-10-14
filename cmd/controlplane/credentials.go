package main

import (
	"context"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/workspace"
)

type configName struct {
	Name string `path:"name" doc:"The credential's label"`
}

// The workspace's own credentials, and the agent credentials turns run on.
func (p *plane) credentials(a huma.API) {
	ws := p.ws
	huma.Register(a, op("credentials.put", "PUT", "/credentials", "Replace the workspace's credentials; one given empty is removed",
		hz{By: []string{"credentials"}}),
		func(_ context.Context, in *struct{ Body workspace.CredentialsInput }) (*struct{}, error) {
			return nil, problem(ws.PutCredentials(workspace.Credentials(in.Body)))
		})
	huma.Register(a, op("credentials.get", "GET", "/credentials", "Which credentials hold a value, never the values",
		hz{By: []string{"credentials ls"}}),
		func(context.Context, *struct{}) (*body[workspace.CredentialsSet], error) {
			return answer(ws.StoredCredentials())
		})
	huma.Register(a, op("credentials.rm", "DELETE", "/credentials/{name}", "Remove a credential: github (agent credentials: hz llm rm)",
		hz{Output: "none"}),
		func(_ context.Context, in *struct {
			Name string `path:"name" doc:"github"`
		}) (*struct{}, error) {
			return nil, problem(ws.RemoveCredential(in.Name))
		})
	huma.Register(a, op("llm.providers", "GET", "/llm/providers", "The agent CLIs a credential can be for, and their fields",
		hz{Output: "table", Columns: []string{"key", "label"}, By: []string{"credentials"}}),
		func(context.Context, *struct{}) (*body[[]llm.Provider], error) {
			return answer(ws.Providers(), nil)
		})
	huma.Register(a, op("llm.ls", "GET", "/llm/configs", "The agent credentials: live first, then archived; secrets left out",
		hz{Output: "table", Columns: []string{"name", "provider", "main", "archived_at", "stored", "values"},
			By: []string{"credentials", "credentials ls"}}),
		func(context.Context, *struct{}) (*body[[]workspace.LLMConfig], error) {
			return answer(ws.Configs())
		})
	huma.Register(a, op("llm.add", "POST", "/llm/configs", "Add an agent credential; the first live one is in use",
		hz{By: []string{"credentials"}}),
		func(_ context.Context, in *struct{ Body workspace.LLMConfigInput }) (*body[workspace.LLMConfig], error) {
			return answer(ws.AddConfig(in.Body))
		})
	huma.Register(a, op("llm.set", "PUT", "/llm/configs/{name}", "Change a credential's values; a secret left empty keeps the stored one",
		hz{By: []string{"credentials"}}),
		func(_ context.Context, in *struct {
			Name string `path:"name" doc:"The credential's label"`
			Body workspace.LLMConfigValues
		}) (*body[workspace.LLMConfig], error) {
			return answer(ws.UpdateConfig(in.Name, in.Body.Values))
		})
	huma.Register(a, op("llm.use", "POST", "/llm/configs/{name}/main", "Run turns on this credential",
		hz{Output: "none", By: []string{"credentials"}}),
		func(_ context.Context, in *configName) (*struct{}, error) {
			return nil, problem(ws.UseConfig(in.Name))
		})
	huma.Register(a, op("llm.restore", "POST", "/llm/configs/{name}/restore", "Bring an archived credential back",
		hz{Output: "none"}),
		func(_ context.Context, in *configName) (*struct{}, error) {
			return nil, problem(ws.RestoreConfig(in.Name))
		})
	huma.Register(a, op("llm.rm", "DELETE", "/llm/configs/{name}", "Archive the credential; --remove deletes it",
		hz{Output: "none"}),
		func(_ context.Context, in *struct {
			Name   string `path:"name" doc:"The credential's label"`
			Remove bool   `query:"remove" doc:"Delete it rather than archive it"`
		}) (*struct{}, error) {
			if in.Remove {
				return nil, problem(ws.RemoveConfig(in.Name))
			}
			return nil, problem(ws.ArchiveConfig(in.Name))
		})
}
