package llm_test

import (
	"reflect"
	"testing"

	"github.com/getnvoi/host0/controlplane/claude"
	"github.com/getnvoi/host0/controlplane/llm"
	"github.com/getnvoi/host0/shared/contract"
)

var runners = []llm.Runner{claude.Runner{}}

func TestCheck(t *testing.T) {
	_, v, err := llm.Check(runners, contract.LLM{Provider: "claude_code", Values: map[string]string{"kind": "api_key", "token": "k"}})
	if err != nil || !reflect.DeepEqual(v, map[string]string{"kind": "api_key", "token": "k", "model": "sonnet"}) {
		t.Fatalf("defaults: %v %v", v, err)
	}
	refused := map[string]contract.LLM{
		"no agent credential: run hz credentials (providers: claude_code)": {},
		`no provider "codex" (providers: claude_code)`:                     {Provider: "codex"},
		"claude_code: token is required":                                   {Provider: "claude_code", Values: map[string]string{"kind": "oauth"}},
		"claude_code: kind must be one of oauth, api_key, bearer":          {Provider: "claude_code", Values: map[string]string{"kind": "x", "token": "k"}},
		"claude_code: no field region":                                     {Provider: "claude_code", Values: map[string]string{"kind": "oauth", "token": "k", "region": "eu"}},
	}
	for want, c := range refused {
		if _, _, err := llm.Check(runners, c); err == nil || err.Error() != want {
			t.Errorf("%+v: got %v, want %s", c, err, want)
		}
	}
}
