package hetzner

import (
	"strings"
	"testing"

	"github.com/getnvoi/host0/shared/naming"
)

func TestAutoscaler(t *testing.T) {
	out, err := Client{token: "t"}.Autoscaler(naming.Cluster{Name: "dev"}, 10, "ccx23", "fsn1", "#cloud-config", map[string]string{"hz.dev/worker": "true"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: hcloud", "--nodes=0:10:ccx23:fsn1:workers", "HCLOUD_NETWORK", "cluster-autoscaler"} {
		if !strings.Contains(out, want) {
			t.Errorf("manifest lacks %q", want)
		}
	}
	if strings.Contains(out, "<no value>") || strings.Contains(out, "cloud-controller") {
		t.Error("manifest has unrendered values or a cloud controller")
	}
}
