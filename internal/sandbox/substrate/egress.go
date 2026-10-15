package substrate

import (
	"net/netip"
	"slices"
)

// Destinations no actor reaches: the cluster's pods and services, the nodes' private network, loopback, link-local.
// Snapshots sit in the cluster's object store under a shared key, so this is the line between sessions.
var private = []string{
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
	"192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/3",
	"::/8", "64:ff9b::/96", "fc00::/7", "fe80::/10", "ff00::/8",
}

// The public address space: every address outside private, as canonical prefixes.
func public() []string {
	var out []string
	for _, all := range []netip.Prefix{netip.MustParsePrefix("0.0.0.0/0"), netip.MustParsePrefix("::/0")} {
		for _, p := range without(all) {
			out = append(out, p.String())
		}
	}
	return out
}

func without(p netip.Prefix) []netip.Prefix {
	for _, s := range private {
		q := netip.MustParsePrefix(s)
		if q.Addr().Is4() != p.Addr().Is4() {
			continue
		}
		if q.Bits() <= p.Bits() && q.Contains(p.Addr()) {
			return nil
		}
		if p.Bits() < q.Bits() && p.Contains(q.Addr()) {
			lo, hi := halves(p)
			return slices.Concat(without(lo), without(hi))
		}
	}
	return []netip.Prefix{p}
}

func halves(p netip.Prefix) (netip.Prefix, netip.Prefix) {
	lo := netip.PrefixFrom(p.Addr(), p.Bits()+1)
	b := p.Addr().AsSlice()
	b[p.Bits()/8] |= 0x80 >> (p.Bits() % 8)
	hi, _ := netip.AddrFromSlice(b)
	return lo, netip.PrefixFrom(hi, p.Bits()+1)
}
