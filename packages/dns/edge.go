package dns

import (
	"context"
	"encoding/json"

	"github.com/getnvoi/host0/shared/naming"
)

// The open-internet edge: per-host A and AAAA records at the control node, and the proxy Deployment serving them.
// It satisfies infra.Edge without importing infra, so the plane can use this package.
type Edge struct {
	Provider     string
	Creds        map[string]string
	Zone, Suffix string
	// The control node's public addresses, looked up when asked.
	Address func(ctx context.Context) ([]string, error)
	Say     func(string, ...any)
}

func (Edge) Ports() []int { return []int{80, 443} }

func (Edge) Deployment() string { return "proxy" }

// The Secret the proxy and the plane read the zone and its credentials from.
const Secret = "dns"

func (e Edge) Serve(ctx context.Context, _ naming.Cluster, _ string, hosts []string) (map[string]map[string]string, error) {
	z, err := Open(e.Provider, e.Creds, e.Zone)
	if err != nil {
		return nil, err
	}
	ips, err := e.Address(ctx)
	if err != nil {
		return nil, err
	}
	for _, h := range hosts {
		done, err := z.Point(h, ips)
		for _, d := range done {
			e.Say("%s", d)
		}
		if err != nil {
			return nil, err
		}
	}
	creds, err := json.Marshal(e.Creds)
	if err != nil {
		return nil, err
	}
	def, err := Provider(e.Provider)
	if err != nil {
		return nil, err
	}
	return map[string]map[string]string{Secret: {"provider": def.TypeName, "zone": z.Name, "creds": string(creds)}}, nil
}

// Every A and AAAA record a host of c's computes to. A challenge TXT left by a proxy that died mid-order cannot be told
// from another tool's, so it stays.
func (e Edge) Destroy(_ context.Context, c naming.Cluster) error {
	z, err := Open(e.Provider, e.Creds, e.Zone)
	if err != nil {
		return err
	}
	done, err := z.Sweep(func(name string) bool { return naming.Owns(c, e.Suffix, e.Zone, name) })
	for _, d := range done {
		e.Say("%s", d)
	}
	return err
}
