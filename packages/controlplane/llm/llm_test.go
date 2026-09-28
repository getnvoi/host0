package llm_test

import (
	"reflect"
	"testing"

	"github.com/getnvoi/host0/controlplane/claude"
	"github.com/getnvoi/host0/controlplane/llm"
)

var runners = []llm.Runner{claude.Runner{}}

func TestCheck(t *testing.T) {
	_, v, err := llm.Check(runners, "claude_code", map[string]string{"kind": "api_key", "token": "k"})
	if err != nil || !reflect.DeepEqual(v, map[string]string{"kind": "api_key", "token": "k", "model": "sonnet"}) {
		t.Fatalf("defaults: %v %v", v, err)
	}
	refused := []struct {
		provider string
		values   map[string]string
		want     string
	}{
		{"codex", nil, `no provider "codex" (providers: claude_code)`},
		{"claude_code", map[string]string{"kind": "oauth"}, "Token is needed"},
		{"claude_code", map[string]string{"kind": "x", "token": "k"}, "Credential kind is not one of the choices"},
		{"claude_code", map[string]string{"kind": "oauth", "token": "k", "region": "eu"}, "Claude Code has no field region"},
	}
	for _, c := range refused {
		if _, _, err := llm.Check(runners, c.provider, c.values); err == nil || err.Error() != c.want {
			t.Errorf("%v: got %v, want %s", c.values, err, c.want)
		}
	}
}
