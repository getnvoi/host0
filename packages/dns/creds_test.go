package dns

import (
	"strings"
	"testing"
)

func TestVars(t *testing.T) {
	for _, c := range []struct{ provider, key, env string }{
		{"CLOUDFLAREAPI", "apitoken", "CLOUDFLARE_API_TOKEN"},
		{"cloudflareapi", "apikey", "CLOUDFLAREAPI_APIKEY"},
		{"ROUTE53", "KeyId", "AWS_ACCESS_KEY_ID"},
		{"GANDI_V5", "token", "GANDI_V5_TOKEN"},
	} {
		vars, err := Vars(c.provider)
		if err != nil {
			t.Fatal(err)
		}
		if vars[c.key] != c.env {
			t.Errorf("%s %s: %q, want %q", c.provider, c.key, vars[c.key], c.env)
		}
		if _, ok := vars["_authMethod"]; ok {
			t.Errorf("%s: a prompt-only key is read", c.provider)
		}
	}
	if _, err := Vars("NOPE"); err == nil {
		t.Fatal("an unknown provider was accepted")
	}
}

func TestRead(t *testing.T) {
	env := map[string]string{"CF": "secret"}
	get := func(k string) string { return env[k] }
	vars := map[string]string{"apitoken": "CF", "apiuser": "CF_USER"}
	creds, err := Read(vars, get, false)
	if err != nil || len(creds) != 1 || creds["apitoken"] != "secret" {
		t.Fatalf("%v %v", creds, err)
	}
	if _, err := Read(vars, get, true); err == nil || !strings.Contains(err.Error(), "CF_USER is not set") {
		t.Fatalf("got %v, want the missing variable named", err)
	}
	if _, err := Read(map[string]string{"token": "NONE"}, get, false); err == nil || !strings.Contains(err.Error(), "NONE") {
		t.Fatalf("got %v", err)
	}
}
