package dns

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"

	"github.com/DNSControl/dnscontrol/v5/models"
)

// A host's owner TXT sits at _hz.<host>: a name of its own, since not every provider takes a TXT beside an A.
const ownerLabel = "_hz."

// The host's A and AAAA values, its owner TXT values, and a CNAME on it if any.
func at(existing models.Records, label string) (addrs, owners []string, cname string) {
	for _, r := range existing {
		switch {
		case strings.EqualFold(r.GetLabel(), label) && (r.Type == "A" || r.Type == "AAAA"):
			addrs = append(addrs, value(r))
		case strings.EqualFold(r.GetLabel(), label) && r.Type == "CNAME":
			cname = value(r)
		case strings.EqualFold(r.GetLabel(), ownerLabel+label) && r.Type == "TXT":
			owners = append(owners, value(r))
		}
	}
	slices.Sort(addrs)
	return addrs, owners, cname
}

func addresses(host string, ips []string) (v4, v6 []string, err error) {
	for _, ip := range ips {
		a, err := netip.ParseAddr(ip)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", host, err)
		}
		if a = a.Unmap(); a.Is4() {
			v4 = append(v4, a.String())
		} else {
			v6 = append(v6, a.String())
		}
	}
	if len(v4)+len(v6) == 0 {
		return nil, nil, fmt.Errorf("%s: no address to point it at", host)
	}
	return v4, v6, nil
}

// Makes host's A and AAAA records exactly ips and marks them owner's. Refused when the name holds a CNAME, or
// addresses another owner (or nobody) wrote.
func (z *Zone) Point(host string, ips []string, owner string) ([]string, error) {
	label, err := z.label(host)
	if err != nil {
		return nil, err
	}
	v4, v6, err := addresses(host, ips)
	if err != nil {
		return nil, err
	}
	return z.apply(func(existing models.Records) ([]edit, error) {
		addrs, owners, cname := at(existing, label)
		if cname != "" {
			return nil, fmt.Errorf("%s is taken: CNAME %s", host, cname)
		}
		if len(addrs) > 0 && !slices.Contains(owners, owner) {
			return nil, fmt.Errorf("%s is taken: %s, not marked %s", host, strings.Join(addrs, " "), owner)
		}
		return []edit{
			{label: label, typ: "A", add: v4, exact: true},
			{label: label, typ: "AAAA", add: v6, exact: true},
			{label: ownerLabel + label, typ: "TXT", add: []string{owner}},
		}, nil
	})
}

// Nil when host's A and AAAA records are exactly ips and marked owner's; otherwise what is there instead. Reads only.
func (z *Zone) Check(host string, ips []string, owner string) error {
	label, err := z.label(host)
	if err != nil {
		return err
	}
	v4, v6, err := addresses(host, ips)
	if err != nil {
		return err
	}
	dc, err := models.NewDomainConfig(z.Name)
	if err != nil {
		return err
	}
	existing, err := z.driver.GetZoneRecords(dc)
	if err != nil {
		return fmt.Errorf("zone %s: %w", z.Name, err)
	}
	addrs, owners, cname := at(existing, label)
	want := slices.Sorted(slices.Values(append(v4, v6...)))
	switch {
	case cname != "":
		return fmt.Errorf("%s is taken: CNAME %s", host, cname)
	case len(addrs) == 0:
		return fmt.Errorf("%s has no record", host)
	case !slices.Contains(owners, owner):
		return fmt.Errorf("%s is taken: %s, not marked %s", host, strings.Join(addrs, " "), owner)
	case !slices.Equal(addrs, want):
		return fmt.Errorf("%s points at %s, not %s", host, strings.Join(addrs, " "), strings.Join(want, " "))
	}
	return nil
}

// Every host marked owner's, with its A and AAAA values and its mark, as the provider holds them now.
func (z *Zone) Owned(owner string) ([]string, error) {
	z.mu.Lock()
	defer z.mu.Unlock()
	dc, err := models.NewDomainConfig(z.Name)
	if err != nil {
		return nil, err
	}
	existing, err := z.driver.GetZoneRecords(dc)
	if err != nil {
		return nil, fmt.Errorf("zone %s: %w", z.Name, err)
	}
	var out []string
	for _, r := range existing {
		label, ok := strings.CutPrefix(strings.ToLower(r.GetLabel()), ownerLabel)
		if !ok || r.Type != "TXT" || value(r) != owner {
			continue
		}
		host := label + "." + z.Name
		for _, a := range existing {
			if strings.EqualFold(a.GetLabel(), label) && (a.Type == "A" || a.Type == "AAAA") {
				out = append(out, fmt.Sprintf("%s %s %s", host, a.Type, value(a)))
			}
		}
		out = append(out, fmt.Sprintf("%s%s TXT %s", ownerLabel, host, owner))
	}
	slices.Sort(out)
	return out, nil
}

// Every host marked owner's: its A and AAAA records and owner's mark go; another mark at that name stays.
func (z *Zone) Sweep(owner string) ([]string, error) {
	return z.apply(func(existing models.Records) ([]edit, error) {
		var edits []edit
		for _, r := range existing {
			label, ok := strings.CutPrefix(strings.ToLower(r.GetLabel()), ownerLabel)
			if !ok || r.Type != "TXT" || value(r) != owner {
				continue
			}
			edits = append(edits,
				edit{label: label, typ: "A", exact: true},
				edit{label: label, typ: "AAAA", exact: true},
				edit{label: ownerLabel + label, typ: "TXT", del: []string{owner}})
		}
		return edits, nil
	})
}
