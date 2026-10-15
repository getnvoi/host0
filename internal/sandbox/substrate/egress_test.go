package substrate

import (
	"net/netip"
	"testing"
)

func TestPublicExcludesThePrivateRanges(t *testing.T) {
	var ps []netip.Prefix
	for _, s := range public() {
		p, err := netip.ParsePrefix(s)
		if err != nil || p != p.Masked() {
			t.Fatalf("%q is not a canonical prefix: %v", s, err)
		}
		ps = append(ps, p)
	}
	if len(ps) > 256 {
		t.Fatalf("%d prefixes; a rule takes 256", len(ps))
	}
	in := func(a string) bool {
		ip := netip.MustParseAddr(a)
		for _, p := range ps {
			if p.Contains(ip) {
				return true
			}
		}
		return false
	}
	for _, a := range []string{"10.43.0.10", "10.42.1.7", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1",
		"100.64.0.1", "::1", "fd00::1", "fe80::1", "64:ff9b::a00:1"} {
		if in(a) {
			t.Errorf("%s is reachable", a)
		}
	}
	for _, a := range []string{"1.1.1.1", "140.82.121.3", "160.79.104.10", "188.245.195.45", "2606:4700::1111", "2a01:4f8:c011:d20::1"} {
		if !in(a) {
			t.Errorf("%s is not reachable", a)
		}
	}
}
