package controlplane

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/getnvoi/host0/shared/contract"
)

func byName(t *testing.T, p *Plane) map[string]contract.LLMConfig {
	all, err := p.Configs()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]contract.LLMConfig{}
	for _, c := range all {
		out[c.Name] = c
	}
	return out
}

func TestConfigMain(t *testing.T) {
	p := &Plane{Store: newStore()}
	oauth := map[string]string{"kind": "oauth", "token": "t"}
	for _, name := range []string{"a", "b", "c"} {
		if _, err := p.AddConfig(contract.LLMConfig{Name: name, Provider: "claude_code", Values: oauth}); err != nil {
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
	if _, err := p.AddConfig(contract.LLMConfig{Name: "c", Provider: "claude_code", Values: oauth}); err == nil {
		t.Fatal("a taken label is refused")
	}
}

func TestConfigSecrets(t *testing.T) {
	p, h := handler(t)
	auth := map[string]string{"Authorization": "Bearer cli-token"}
	res := call(h, "POST", "api-dev.nvoi.to", "/llm/configs",
		`{"name":"work","provider":"claude_code","values":{"kind":"api_key","token":"sk-1"}}`, auth)
	if res.Code != 200 || strings.Contains(res.Body.String(), "sk-1") {
		t.Fatalf("add: %d %s", res.Code, res.Body)
	}
	res = call(h, "PUT", "api-dev.nvoi.to", "/llm/configs/work", `{"values":{"kind":"api_key","token":"","model":"opus"}}`, auth)
	var c contract.LLMConfig
	json.Unmarshal(res.Body.Bytes(), &c)
	if res.Code != 200 || !reflect.DeepEqual(c.Stored, []string{"token"}) || c.Values["model"] != "opus" || c.Values["token"] != "" {
		t.Fatalf("update: %d %s", res.Code, res.Body)
	}
	if _, v, _ := p.runner(); v["token"] != "sk-1" {
		t.Fatalf("an empty secret keeps the stored one: %v", v)
	}
	res = call(h, "POST", "api-dev.nvoi.to", "/llm/configs", `{"name":"x","provider":"claude_code","values":{"kind":"oauth"}}`, auth)
	if res.Code != 400 || strings.TrimSpace(res.Body.String()) != "Token is needed" {
		t.Fatalf("missing token: %d %s", res.Code, res.Body)
	}
}
