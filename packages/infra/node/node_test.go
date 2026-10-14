package node

import (
	"strings"
	"testing"
)

func TestRender(t *testing.T) {
	server := Server("hcloud://42", "203.0.113.7,2001:db8::1")
	worker := Worker("secret-token", Labels("31a5e0ba-dirty"), "provider_id=from-metadata\n")
	for _, s := range []string{server, worker} {
		if strings.Contains(s, "<no value>") || strings.Contains(s, "{{") {
			t.Fatalf("unrendered template:\n%s", s)
		}
	}
	if strings.Contains(server, "disable-cloud-controller") {
		t.Error("the server disables k3s's cloud controller, which sets ExternalIP from node-external-ip")
	}
	for _, want := range []string{"INSTALL_K3S_EXEC=\"server\"", `provider_id="hcloud://42"`, `external_ips="203.0.113.7,2001:db8::1"`,
		`node-external-ip: "$external_ips"`, "provider-id=$provider_id", "localhost:15001"} {
		if !strings.Contains(server, want) {
			t.Errorf("server script lacks %q", want)
		}
	}
	for _, want := range []string{"#cloud-config", "token: secret-token", "server: https://10.0.1.2:6443", "ate.dev/sandboxClass=gvisor:NoSchedule", "ate.dev/substrate-version=31a5e0ba-dirty",
		"provider_id=from-metadata", "provider-id=$provider_id"} {
		if !strings.Contains(worker, want) {
			t.Errorf("worker cloud-init lacks %q", want)
		}
	}
}
