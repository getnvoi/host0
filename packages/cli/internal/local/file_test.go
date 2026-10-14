package local

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cloudflare"
	"github.com/getnvoi/host0/dns"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/shared/tiers"
)

func TestLoadExample(t *testing.T) {
	f, err := Load("../../../../examples/cluster.yml")
	if err != nil {
		t.Fatal(err)
	}
	if f.Name != "dev" || f.Workers.Max != 5 || f.Workers.Idle != "10m" || f.Control.Type != "ccx23" || len(f.Tiers) != 3 ||
		f.Cloud.Provider != "hetzner" || f.Cloud.Credentials["token"] != "HCLOUD_TOKEN" ||
		f.Edge.Mode != "public" || f.Edge.Zone != "nvoi.to" || f.Edge.PreviewSuffix != "-preview" ||
		f.DNS.Provider != "CLOUDFLAREAPI" || f.DNS.Credentials["apitoken"] != "CLOUDFLARE_API_TOKEN" {
		t.Fatalf("%+v", f)
	}
}

func TestLoadStrict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cluster.yml")
	if err := os.WriteFile(path, []byte("name: dev\nedge: { zone: nvoi.to, sufix: -p }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Load(path)
	if err == nil || !strings.HasPrefix(err.Error(), path+":") || !strings.Contains(err.Error(), "sufix") {
		t.Fatalf("got %v, want the unknown key named after the file", err)
	}
}

func TestMergeFlagWins(t *testing.T) {
	var o options
	c := &cobra.Command{Use: "install"}
	common(c, &o)
	installFlags(c, &o)
	if err := c.Flags().Parse([]string{"--zone", "other.to", "--worker-idle", "2m"}); err != nil {
		t.Fatal(err)
	}
	f, err := Load("../../../../examples/cluster.yml")
	if err != nil {
		t.Fatal(err)
	}
	if err := merge(c, &o, f); err != nil {
		t.Fatal(err)
	}
	if o.cfg.Zone != "other.to" || o.edge != "public" || o.cfg.WorkerMax != 5 || o.cfg.WorkerIdle != 2*time.Minute ||
		o.provider != "CLOUDFLAREAPI" || o.cloud != "hetzner" || o.cfg.ControlType != "ccx23" || o.cfg.WorkerType != "ccx23" ||
		o.cfg.Location != "fsn1" {
		t.Fatalf("%+v", o)
	}
}

func TestTiers(t *testing.T) {
	f, err := Load("../../../../examples/cluster.yml")
	if err != nil {
		t.Fatal(err)
	}
	ts, err := tierList(options{}, f)
	if err != nil || !slices.Equal(ts, tiers.Defaults) {
		t.Fatalf("the example's tiers are not the defaults: %+v %v", ts, err)
	}
	ts, err = tierList(options{tiers: []string{"tiny:500m:1Gi"}}, f)
	if err != nil || len(ts) != 1 || ts[0] != (tiers.Tier{Name: "tiny", CPU: "500m", Memory: "1Gi", CPURequest: "125m", Default: true}) {
		t.Fatalf("--tier: %+v %v", ts, err)
	}
	if _, err := tierList(options{tiers: []string{"a:1:1Gi", "b:2:2Gi"}}, File{}); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("no default: %v", err)
	}
	if _, err := tierList(options{tiers: []string{"a:1"}}, File{}); err == nil {
		t.Fatal("a tier without memory is taken")
	}
	if ts, err := tierList(options{}, File{}); err != nil || !slices.Equal(ts, tiers.Defaults) {
		t.Fatalf("defaults: %+v %v", ts, err)
	}
}

func TestSelectEdge(t *testing.T) {
	t.Setenv("CLOUDFLARE_API_TOKEN", "cf")
	t.Setenv("GANDI_V5_TOKEN", "gandi")
	say := func(string, ...any) {}
	o := options{provider: "CLOUDFLAREAPI", cfg: infra.Config{Zone: "nvoi.to"}}
	if e, err := selectEdge(o, say, nil); err != nil || e.(cloudflare.Client).Token != "cf" {
		t.Fatalf("default on Cloudflare: %#v %v", e, err)
	}
	o.edge = "public"
	if e, err := selectEdge(o, say, nil); err != nil || e.(dns.Edge).Creds["apitoken"] != "cf" {
		t.Fatalf("public on Cloudflare: %#v %v", e, err)
	}
	o.edge, o.provider = "", "GANDI_V5"
	if e, err := selectEdge(o, say, nil); err != nil || e.(dns.Edge).Creds["token"] != "gandi" {
		t.Fatalf("default elsewhere: %#v %v", e, err)
	}
	o.edge = "tunnel"
	if _, err := selectEdge(o, say, nil); err == nil || !strings.Contains(err.Error(), "CLOUDFLAREAPI") {
		t.Fatalf("tunnel on Gandi: %v", err)
	}
	o.dnsVars = map[string]string{"token": "GANDI_TOKEN_UNSET"}
	o.edge = ""
	if _, err := selectEdge(o, say, nil); err == nil || !strings.Contains(err.Error(), "GANDI_TOKEN_UNSET is not set") {
		t.Fatalf("missing variable: %v", err)
	}
}
