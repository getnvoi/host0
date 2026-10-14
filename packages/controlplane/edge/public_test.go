package edge

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getnvoi/host0/dns"
	"github.com/getnvoi/host0/shared/naming"
)

func TestPublic(t *testing.T) {
	dir := t.TempDir()
	zonefile := "@ 3600 IN SOA ns1.example.net. hostmaster.nvoi.to. 1 3600 600 604800 1440\nwww 3600 IN A 192.0.2.10\n"
	if err := os.WriteFile(filepath.Join(dir, "nvoi.to.zone"), []byte(zonefile), 0o644); err != nil {
		t.Fatal(err)
	}
	z, err := dns.Open("BIND", map[string]string{"directory": dir}, "nvoi.to")
	if err != nil {
		t.Fatal(err)
	}
	c := naming.Cluster{Name: "dev"}
	ips := []string{"203.0.113.7"}
	p := Public{Zone: z, Owns: func(h string) bool { return naming.Owns(c, "-preview", "nvoi.to", h) },
		Addresses: func(context.Context) ([]string, error) { return ips, nil }}
	ctx := context.Background()
	host := "4ca708e1-dev-preview.nvoi.to"
	if err := p.Check(ctx, host); err == nil {
		t.Fatal("check passed before route")
	}
	if err := p.Route(ctx, host); err != nil {
		t.Fatal(err)
	}
	if err := p.Check(ctx, host); err != nil {
		t.Fatal(err)
	}
	// The node's address moved: the check sees it, the next route follows it.
	ips = []string{"203.0.113.8"}
	if err := p.Check(ctx, host); err == nil || !strings.Contains(err.Error(), "203.0.113.7") {
		t.Fatalf("check after move: %v", err)
	}
	if err := p.Route(ctx, host); err != nil {
		t.Fatal(err)
	}
	if err := p.Check(ctx, host); err != nil {
		t.Fatal(err)
	}
	if err := p.Route(ctx, "www.nvoi.to"); err == nil {
		t.Fatal("a name the cluster does not compute was written")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "nvoi.to.zone"))
	if !strings.Contains(string(raw), "192.0.2.10") {
		t.Fatalf("www lost:\n%s", raw)
	}
}
