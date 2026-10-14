package local

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cloudflare"
	"github.com/getnvoi/host0/dns"
	"github.com/getnvoi/host0/infra"
)

func TestLoadExample(t *testing.T) {
	f, err := Load("../../../../examples/cluster.yml")
	if err != nil {
		t.Fatal(err)
	}
	if f.Name != "dev" || f.Cloud.WorkerMax != 5 || f.Cloud.Credentials["token"] != "HCLOUD_TOKEN" ||
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
	c.Flags().IntVar(&o.cfg.WorkerMax, "worker-max", 10, "")
	if err := c.Flags().Parse([]string{"--zone", "other.to"}); err != nil {
		t.Fatal(err)
	}
	f, err := Load("../../../../examples/cluster.yml")
	if err != nil {
		t.Fatal(err)
	}
	merge(c, &o, f)
	if o.cfg.Zone != "other.to" || o.edge != "public" || o.cfg.WorkerMax != 5 || o.provider != "CLOUDFLAREAPI" {
		t.Fatalf("%+v", o)
	}
}

func TestSelectEdge(t *testing.T) {
	t.Setenv("CLOUDFLARE_API_TOKEN", "cf")
	t.Setenv("GANDI_V5_TOKEN", "gandi")
	say := func(string, ...any) {}
	o := options{provider: "CLOUDFLAREAPI", cfg: infra.Config{Zone: "nvoi.to"}}
	if e, err := selectEdge(o, File{}, say, nil); err != nil || e.(cloudflare.Client).Token != "cf" {
		t.Fatalf("default on Cloudflare: %#v %v", e, err)
	}
	o.edge = "public"
	if e, err := selectEdge(o, File{}, say, nil); err != nil || e.(dns.Edge).Creds["apitoken"] != "cf" {
		t.Fatalf("public on Cloudflare: %#v %v", e, err)
	}
	o.edge, o.provider = "", "GANDI_V5"
	if e, err := selectEdge(o, File{}, say, nil); err != nil || e.(dns.Edge).Creds["token"] != "gandi" {
		t.Fatalf("default elsewhere: %#v %v", e, err)
	}
	o.edge = "tunnel"
	if _, err := selectEdge(o, File{}, say, nil); err == nil || !strings.Contains(err.Error(), "CLOUDFLAREAPI") {
		t.Fatalf("tunnel on Gandi: %v", err)
	}
	var f File
	f.DNS.Credentials = map[string]string{"token": "GANDI_TOKEN_UNSET"}
	o.edge = ""
	if _, err := selectEdge(o, f, say, nil); err == nil || !strings.Contains(err.Error(), "GANDI_TOKEN_UNSET is not set") {
		t.Fatalf("missing variable: %v", err)
	}
}
