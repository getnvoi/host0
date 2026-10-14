package workspace

import (
	"strings"
	"testing"
)

func byName(t *testing.T, p *Workspace) map[string]LLMConfig {
	all, err := p.Configs()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]LLMConfig{}
	for _, c := range all {
		out[c.Name] = c
	}
	return out
}

func TestConfigMain(t *testing.T) {
	p := newWorkspace(nil)
	oauth := map[string]string{"kind": "oauth", "token": "t"}
	for _, name := range []string{"a", "b", "c"} {
		if _, err := p.AddConfig(LLMConfig{Name: name, Provider: "claude_code", Values: oauth}); err != nil {
			t.Fatal(err)
		}
	}
	if !byName(t, p)["a"].Main || byName(t, p)["b"].Main {
		t.Fatal("the first is main")
	}
	if err := p.UseConfig("c"); err != nil || !byName(t, p)["c"].Main || byName(t, p)["a"].Main {
		t.Fatalf("use c: %v", err)
	}
	if err := p.ArchiveConfig("c"); err != nil || !byName(t, p)["a"].Main {
		t.Fatalf("archiving main hands over to the oldest live: %v", err)
	}
	if err := p.UseConfig("c"); err == nil {
		t.Fatal("an archived credential is not used")
	}
	p.RemoveConfig("a")
	p.RemoveConfig("b")
	if _, _, err := p.runner(); err == nil || !strings.Contains(err.Error(), "no agent credential") {
		t.Fatalf("only an archived one left: %v", err)
	}
	if err := p.RestoreConfig("c"); err != nil || !byName(t, p)["c"].Main {
		t.Fatalf("restored into an empty set becomes main: %v", err)
	}
	if _, err := p.AddConfig(LLMConfig{Name: "c", Provider: "claude_code", Values: oauth}); err == nil {
		t.Fatal("a taken label is refused")
	}
}
