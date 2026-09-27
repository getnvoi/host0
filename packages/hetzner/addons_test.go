package hetzner

import (
	"strings"
	"testing"

	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/shared/naming"
)

func TestAddons(t *testing.T) {
	cfg := Client{}.Defaults()
	cfg.WorkerMax = 10
	out, err := Client{Token: "t"}.Addons(naming.Cluster{Name: "dev"}, cfg, "#cloud-config", map[string]string{"hz.dev/worker": "true"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: hcloud", "--nodes=0:10:ccx23:fsn1:workers", "HCLOUD_NETWORK", "hcloud-cloud-controller-manager"} {
		if !strings.Contains(out, want) {
			t.Errorf("addons lack %q", want)
		}
	}
	if strings.Contains(out, "<no value>") {
		t.Error("addons have unrendered values")
	}
}

var _ infra.Cloud = Client{}
