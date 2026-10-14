// A zone at any dnscontrol provider. A change reads the zone and touches only the names and values it is handed.
package dns

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"
	"sync"

	"github.com/DNSControl/dnscontrol/v5/models"
	"github.com/DNSControl/dnscontrol/v5/pkg/providers"
	_ "github.com/DNSControl/dnscontrol/v5/pkg/providers/_all"
	"github.com/DNSControl/dnscontrol/v5/pkg/zonerecs"
)

// Seconds, for the records a change creates.
const TTL = 300

type Zone struct {
	Name   string
	driver models.DNSProvider
	mu     sync.Mutex
}

// The provider dnscontrol knows by name or alias, in any case.
func Provider(name string) (*providers.Definition, error) {
	def, ok := providers.GetDefinition(strings.ToUpper(name))
	if !ok || !def.Kind.Has(providers.KindDNS) {
		return nil, fmt.Errorf("dnscontrol has no DNS provider %q", name)
	}
	return def, nil
}

func Open(provider string, creds map[string]string, zone string) (*Zone, error) {
	def, err := Provider(provider)
	if err != nil {
		return nil, err
	}
	d, err := providers.CreateDNSProvider(def.TypeName, creds, nil)
	if err != nil {
		return nil, fmt.Errorf("dns %s: %w", def.TypeName, err)
	}
	return &Zone{Name: strings.ToLower(strings.TrimSuffix(zone, ".")), driver: d}, nil
}

// The values one name and type ends with: add is made present, del removed, and with exact every other value goes too.
type edit struct {
	label, typ string
	add, del   []string
	exact      bool
}

// Reads the zone, asks plan for the edits, applies what they change; returns each change's description.
func (z *Zone) apply(plan func(existing models.Records) ([]edit, error)) ([]string, error) {
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
	edits, err := plan(existing)
	if err != nil {
		return nil, err
	}
	// NO_PURGE: a name and type no edit names is never deleted.
	dc.KeepUnknown = true
	for _, r := range existing {
		// A provider that writes a default SOA when none is desired (BIND) would replace the zone's own.
		if r.Type == "SOA" {
			dc.Records = append(dc.Records, r)
		}
	}
	for _, e := range merge(edits) {
		present := map[string]bool{}
		for _, r := range existing {
			if !strings.EqualFold(r.GetLabel(), e.label) || r.Type != e.typ {
				continue
			}
			v := value(r)
			if slices.Contains(e.del, v) || e.exact && !slices.Contains(e.add, v) {
				dc.EnsureAbsent = append(dc.EnsureAbsent, r)
				continue
			}
			dc.Records = append(dc.Records, r)
			present[v] = true
		}
		for _, v := range e.add {
			if present[v] || slices.Contains(e.del, v) {
				continue
			}
			rc, err := dc.NewRecordConfig(e.label, TTL, e.typ, v)
			if err != nil {
				return nil, fmt.Errorf("%s %s %s: %w", e.typ, e.label, v, err)
			}
			dc.Records = append(dc.Records, rc)
			present[v] = true
		}
	}
	_, corrections, _, err := zonerecs.CorrectZoneRecords(z.driver, dc)
	if err != nil {
		return nil, fmt.Errorf("zone %s: %w", z.Name, err)
	}
	var done []string
	for _, c := range corrections {
		if err := c.F(); err != nil {
			return done, fmt.Errorf("zone %s: %s: %w", z.Name, c.Msg, err)
		}
		done = append(done, c.Msg)
	}
	return done, nil
}

// One edit per name and type, so a record already there is carried once.
func merge(edits []edit) []edit {
	var out []edit
	at := map[string]int{}
	for _, e := range edits {
		e.label = strings.ToLower(e.label)
		k := e.label + " " + e.typ
		i, ok := at[k]
		if !ok {
			at[k] = len(out)
			out = append(out, e)
			continue
		}
		out[i].add = append(out[i].add, e.add...)
		out[i].del = append(out[i].del, e.del...)
		out[i].exact = out[i].exact || e.exact
	}
	return out
}

// The record's value as a change names it: an address in canonical form, a TXT's strings joined.
func value(r *models.RecordConfig) string {
	switch r.Type {
	case "A":
		return r.AsA().Addr.String()
	case "AAAA":
		return r.AsAAAA().Addr.String()
	case "TXT":
		return r.GetTargetTXTJoined()
	}
	return r.GetTargetField()
}

// The name relative to the zone, "@" for its apex; an error when the name is not in it.
func (z *Zone) label(name string) (string, error) {
	name = strings.ToLower(strings.TrimSuffix(name, "."))
	if name == z.Name {
		return "@", nil
	}
	if l, ok := strings.CutSuffix(name, "."+z.Name); ok {
		return l, nil
	}
	return "", fmt.Errorf("%s is not in zone %s", name, z.Name)
}

// Makes host's A and AAAA records exactly ips. Refused when another type of record holds the name.
func (z *Zone) Point(host string, ips []string) ([]string, error) {
	label, err := z.label(host)
	if err != nil {
		return nil, err
	}
	var v4, v6 []string
	for _, ip := range ips {
		a, err := netip.ParseAddr(ip)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", host, err)
		}
		if a.Unmap().Is4() {
			v4 = append(v4, a.Unmap().String())
		} else {
			v6 = append(v6, a.String())
		}
	}
	if len(v4)+len(v6) == 0 {
		return nil, fmt.Errorf("%s: no address to point it at", host)
	}
	return z.apply(func(existing models.Records) ([]edit, error) {
		for _, r := range existing {
			if strings.EqualFold(r.GetLabel(), label) && r.Type == "CNAME" {
				return nil, fmt.Errorf("%s is taken: CNAME %s", host, value(r))
			}
		}
		return []edit{{label: label, typ: "A", add: v4, exact: true}, {label: label, typ: "AAAA", add: v6, exact: true}}, nil
	})
}

// Nil when host's A and AAAA records are exactly ips; otherwise what is there instead. Reads only.
func (z *Zone) Check(host string, ips []string) error {
	label, err := z.label(host)
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
	var want, have []string
	for _, ip := range ips {
		a, err := netip.ParseAddr(ip)
		if err != nil {
			return fmt.Errorf("%s: %w", host, err)
		}
		want = append(want, a.Unmap().String())
	}
	for _, r := range existing {
		if !strings.EqualFold(r.GetLabel(), label) {
			continue
		}
		switch r.Type {
		case "A", "AAAA":
			have = append(have, value(r))
		case "CNAME":
			return fmt.Errorf("%s is taken: CNAME %s", host, value(r))
		}
	}
	slices.Sort(want)
	slices.Sort(have)
	if len(have) == 0 {
		return fmt.Errorf("%s has no record", host)
	}
	if !slices.Equal(want, have) {
		return fmt.Errorf("%s points at %s, not %s", host, strings.Join(have, " "), strings.Join(want, " "))
	}
	return nil
}

// Removes every A and AAAA record whose name owned accepts.
func (z *Zone) Sweep(owned func(name string) bool) ([]string, error) {
	return z.apply(func(existing models.Records) ([]edit, error) {
		var edits []edit
		seen := map[string]bool{}
		for _, r := range existing {
			if (r.Type == "A" || r.Type == "AAAA") && owned(r.GetLabelFQDN()) && !seen[r.GetLabel()+" "+r.Type] {
				seen[r.GetLabel()+" "+r.Type] = true
				edits = append(edits, edit{label: r.GetLabel(), typ: r.Type, exact: true})
			}
		}
		return edits, nil
	})
}
