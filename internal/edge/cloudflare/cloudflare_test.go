package cloudflare

import (
	"encoding/json"
	"testing"
)

// Each extra host is a rule ahead of the plane's catch-all, in a stable order.
func TestIngress(t *testing.T) {
	got, _ := json.Marshal(ingress(map[string]string{"local.hostzero.app": "http://host.docker.internal:5490", "a.hostzero.app": "http://a:1"},
		"http://plane.h0-system.svc:80"))
	want := `{"config":{"ingress":[{"hostname":"a.hostzero.app","service":"http://a:1"},` +
		`{"hostname":"local.hostzero.app","service":"http://host.docker.internal:5490"},{"service":"http://plane.h0-system.svc:80"}]}}`
	if string(got) != want {
		t.Fatalf("ingress\n%s\nwant\n%s", got, want)
	}
	if got, _ := json.Marshal(ingress(nil, "http://p")); string(got) != `{"config":{"ingress":[{"service":"http://p"}]}}` {
		t.Fatalf("no hosts: %s", got)
	}
}
