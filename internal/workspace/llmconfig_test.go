package workspace

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/llm/claude"
)

func TestConfigVerified(t *testing.T) {
	p := newWorkspace(t, nil)
	ctx := context.Background()
	bad := LLMConfigInput{Name: "a", Provider: "claude_code", Values: map[string]string{"kind": "api_key", "token": "bad"}}
	_, err := p.AddConfig(ctx, bad)
	if !errors.As(err, new(Invalid)) || !strings.HasSuffix(err.Error(), "answered 401 Unauthorized: invalid x-api-key") {
		t.Fatalf("a refused key: %v", err)
	}
	if len(byName(t, p)) != 0 {
		t.Fatal("a refused key is not saved")
	}
	bad.Values = map[string]string{"kind": "api_key", "token": "sk-ant-api03"}
	if _, err := p.AddConfig(ctx, bad); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpdateConfig(ctx, "a", map[string]string{"kind": "api_key", "token": "bad"}); !errors.As(err, new(Invalid)) {
		t.Fatalf("a refused change: %v", err)
	}
	if c, _ := p.config("a"); c.Values["token"] != "sk-ant-api03" {
		t.Fatalf("a refused change keeps the stored values: %v", c.Values)
	}
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()
	p.Runners = []llm.Runner{claude.Runner{API: srv.URL}}
	_, err = p.AddConfig(ctx, LLMConfigInput{Name: "b", Provider: "claude_code", Values: map[string]string{"kind": "oauth", "token": "t"}})
	if !errors.As(err, new(llm.Unreachable)) || errors.As(err, new(Invalid)) {
		t.Fatalf("an endpoint out of reach is not a refused key: %v", err)
	}
}

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
	p := newWorkspace(t, nil)
	oauth := map[string]string{"kind": "oauth", "token": "t"}
	for _, name := range []string{"a", "b", "c"} {
		if _, err := p.AddConfig(context.Background(), LLMConfigInput{Name: name, Provider: "claude_code", Values: oauth}); err != nil {
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
	if _, err := p.AddConfig(context.Background(), LLMConfigInput{Name: "c", Provider: "claude_code", Values: oauth}); err == nil {
		t.Fatal("a taken label is refused")
	}
}
