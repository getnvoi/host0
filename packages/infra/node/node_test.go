package node

import (
	"strings"
	"testing"
)

func TestRender(t *testing.T) {
	server, worker := Server(), Worker("secret-token", Labels("31a5e0ba-dirty"))
	for _, s := range []string{server, worker} {
		if strings.Contains(s, "<no value>") || strings.Contains(s, "{{") {
			t.Fatalf("unrendered template:\n%s", s)
		}
	}
	for _, want := range []string{"INSTALL_K3S_EXEC=\"server\"", "disable-cloud-controller: true", "localhost:15001"} {
		if !strings.Contains(server, want) {
			t.Errorf("server script lacks %q", want)
		}
	}
	for _, want := range []string{"#cloud-config", "token: secret-token", "server: https://10.0.1.2:6443", "ate.dev/sandboxClass=gvisor:NoSchedule", "ate.dev/substrate-version=31a5e0ba-dirty"} {
		if !strings.Contains(worker, want) {
			t.Errorf("worker cloud-init lacks %q", want)
		}
	}
}
