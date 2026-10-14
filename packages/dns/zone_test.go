package dns

import (
	"context"
	"net/netip"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/DNSControl/dnscontrol/v5/models"
	"github.com/libdns/libdns"

	"github.com/getnvoi/host0/shared/naming"
)

// A zone somebody already runs: mail, a website, another tool's challenge value, the user's own x-dev, another
// cluster's host, and a host and a preview an earlier install of dev marked its own.
const zonefile = `$TTL 3600
@                   IN SOA   ns1.example.net. hostmaster.nvoi.to. 2026010100 3600 600 604800 1440
@                   IN NS    ns1.example.net.
@                   IN A     192.0.2.10
@                   IN MX    10 mail.nvoi.to.
@                   IN TXT   "v=spf1 mx -all"
www                 IN CNAME nvoi.to.
mail                IN A     192.0.2.20
_acme-challenge     IN TXT   "another-tools-token"
x-dev               IN A     192.0.2.40
api-prod            IN A     192.0.2.30
_hz.api-prod        IN TXT   "hz/owner=hz-prod"
api-dev             IN A     198.51.100.1
_hz.api-dev         IN TXT   "hz/owner=hz-dev"
api-dev             IN TXT   "kept: not an address"
old-dev-preview     IN AAAA  2001:db8::99
_hz.old-dev-preview IN TXT   "hz/owner=hz-dev"
taken-dev           IN CNAME elsewhere.example.
`

const owner = "hz/owner=hz-dev"

func open(t *testing.T) (*Zone, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "nvoi.to.zone"), []byte(zonefile), 0o644); err != nil {
		t.Fatal(err)
	}
	z, err := Open("BIND", map[string]string{"directory": dir}, "nvoi.to")
	if err != nil {
		t.Fatal(err)
	}
	return z, dir
}

// Every record as "label TYPE value", the SOA left out: BIND moves its serial on every write.
func records(t *testing.T, z *Zone) []string {
	t.Helper()
	dc, _ := models.NewDomainConfig(z.Name)
	rs, err := z.driver.GetZoneRecords(dc)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range rs {
		if r.Type != "SOA" {
			out = append(out, r.GetLabel()+" "+r.Type+" "+value(r))
		}
	}
	slices.Sort(out)
	return out
}

func without(all []string, drop ...string) []string {
	return slices.DeleteFunc(slices.Clone(all), func(s string) bool { return slices.Contains(drop, s) })
}

func with(all []string, add ...string) []string {
	out := append(slices.Clone(all), add...)
	slices.Sort(out)
	return out
}

func same(t *testing.T, got, want []string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("records:\n  got  %s\n  want %s", strings.Join(got, "\n       "), strings.Join(want, "\n       "))
	}
}

func TestPoint(t *testing.T) {
	z, _ := open(t)
	before := records(t, z)
	if err := z.Check("api-dev.nvoi.to", []string{"203.0.113.7"}, owner); err == nil || !strings.Contains(err.Error(), "198.51.100.1") {
		t.Fatalf("check before: %v", err)
	}
	if err := z.Check("app-dev.nvoi.to", []string{"203.0.113.7"}, owner); err == nil || !strings.Contains(err.Error(), "no record") {
		t.Fatalf("check absent: %v", err)
	}
	done, err := z.Point("api-dev.nvoi.to", []string{"203.0.113.7", "2001:db8::7"}, owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(done) == 0 {
		t.Fatal("no change reported")
	}
	same(t, records(t, z), with(without(before, "api-dev A 198.51.100.1"),
		"api-dev A 203.0.113.7", "api-dev AAAA 2001:db8::7"))
	if err := z.Check("api-dev.nvoi.to", []string{"2001:db8::7", "203.0.113.7"}, owner); err != nil {
		t.Fatal(err)
	}
	// Converged: a second run changes nothing.
	if done, err := z.Point("api-dev.nvoi.to.", []string{"2001:db8::7", "203.0.113.7"}, owner); err != nil || len(done) != 0 {
		t.Fatalf("second run: %v %v", done, err)
	}
	// An address gone from the node goes from the record.
	if _, err := z.Point("api-dev.nvoi.to", []string{"203.0.113.7"}, owner); err != nil {
		t.Fatal(err)
	}
	same(t, records(t, z), with(without(before, "api-dev A 198.51.100.1"), "api-dev A 203.0.113.7"))
	// A new host is marked as it is made.
	if _, err := z.Point("app-dev.nvoi.to", []string{"203.0.113.7"}, owner); err != nil {
		t.Fatal(err)
	}
	same(t, records(t, z), with(without(before, "api-dev A 198.51.100.1"), "api-dev A 203.0.113.7",
		"app-dev A 203.0.113.7", "_hz.app-dev TXT "+owner))
}

func TestPointRefusesTaken(t *testing.T) {
	z, _ := open(t)
	before := records(t, z)
	for host, want := range map[string]string{
		"taken-dev.nvoi.to": "CNAME",
		"x-dev.nvoi.to":     "192.0.2.40, not marked",
		"api-prod.nvoi.to":  "192.0.2.30, not marked",
		"api-dev.other.to":  "not in zone",
	} {
		if _, err := z.Point(host, []string{"203.0.113.7"}, owner); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want %q", host, err, want)
		}
	}
	if err := z.Check("x-dev.nvoi.to", []string{"192.0.2.40"}, owner); err == nil || !strings.Contains(err.Error(), "not marked") {
		t.Errorf("check of a foreign host: %v", err)
	}
	same(t, records(t, z), before)
}

func TestChallenge(t *testing.T) {
	z, _ := open(t)
	before := records(t, z)
	ctx := context.Background()
	ours := []libdns.Record{libdns.TXT{Name: "_acme-challenge", Text: "our-token"}}
	if _, err := z.AppendRecords(ctx, "nvoi.to.", ours); err != nil {
		t.Fatal(err)
	}
	same(t, records(t, z), with(before, "_acme-challenge TXT our-token"))

	// A host converged while the challenge is in flight leaves it there.
	if _, err := z.Point("app-dev.nvoi.to", []string{"203.0.113.7"}, owner); err != nil {
		t.Fatal(err)
	}
	made := with(before, "app-dev A 203.0.113.7", "_hz.app-dev TXT "+owner)
	same(t, records(t, z), with(made, "_acme-challenge TXT our-token"))

	// Named relative to a parent zone, as a resolver may hand it.
	if _, err := z.DeleteRecords(ctx, "to.", []libdns.Record{libdns.TXT{Name: "_acme-challenge.nvoi", Text: "our-token"}}); err != nil {
		t.Fatal(err)
	}
	same(t, records(t, z), made)

	if _, err := z.AppendRecords(ctx, "nvoi.to.", []libdns.Record{libdns.Address{Name: "x", IP: netip.MustParseAddr("192.0.2.1")}}); err == nil {
		t.Fatal("a non-TXT record was written")
	}
}

func TestEdge(t *testing.T) {
	z, dir := open(t)
	before := records(t, z)
	c := naming.Cluster{Name: "dev"}
	e := Edge{Provider: "bind", Creds: map[string]string{"directory": dir}, Zone: "nvoi.to", Suffix: "-preview",
		Address: func(context.Context) ([]string, error) { return []string{"203.0.113.7"}, nil },
		Say:     func(string, ...any) {}}
	ctx := context.Background()
	if _, err := e.Serve(ctx, c, "http://plane", []string{"www.nvoi.to"}); err == nil {
		t.Fatal("a name the cluster does not compute was served")
	}
	hosts := []string{naming.Host(c, "api", "nvoi.to"), naming.Host(c, "app", "nvoi.to")}
	secrets, err := e.Serve(ctx, c, "http://plane", hosts)
	if err != nil {
		t.Fatal(err)
	}
	if s := secrets[Secret]; s["provider"] != "BIND" || s["zone"] != "nvoi.to" || !strings.Contains(s["creds"], dir) {
		t.Fatalf("secret %v", s)
	}
	same(t, records(t, z), with(without(before, "api-dev A 198.51.100.1"),
		"api-dev A 203.0.113.7", "app-dev A 203.0.113.7", "_hz.app-dev TXT "+owner))
	if _, err := e.Serve(ctx, c, "http://plane", hosts); err != nil {
		t.Fatal(err)
	}
	// A challenge in flight when the cluster goes.
	if _, err := z.AppendRecords(ctx, "nvoi.to.", []libdns.Record{libdns.TXT{Name: "_acme-challenge", Text: "our-token"}}); err != nil {
		t.Fatal(err)
	}
	if err := e.Destroy(ctx, c); err != nil {
		t.Fatal(err)
	}
	// Only what dev marked goes: x-dev, the other cluster's host and the TXT beside api-dev stay.
	same(t, records(t, z), with(without(before, "api-dev A 198.51.100.1", "_hz.api-dev TXT "+owner,
		"old-dev-preview AAAA 2001:db8::99", "_hz.old-dev-preview TXT "+owner), "_acme-challenge TXT our-token"))
	if err := e.Destroy(ctx, c); err != nil {
		t.Fatal(err)
	}
}

func TestOwned(t *testing.T) {
	z, _ := open(t)
	got, err := z.Owned(owner)
	if err != nil {
		t.Fatal(err)
	}
	// api-prod is another cluster's, x-dev and taken-dev carry no mark.
	same(t, got, []string{
		"_hz.api-dev.nvoi.to TXT " + owner,
		"_hz.old-dev-preview.nvoi.to TXT " + owner,
		"api-dev.nvoi.to A 198.51.100.1",
		"old-dev-preview.nvoi.to AAAA 2001:db8::99",
	})
}
