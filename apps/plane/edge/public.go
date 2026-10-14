package edge

import (
	"context"
	"fmt"

	"github.com/getnvoi/host0/edge/dns"
	"github.com/getnvoi/host0/plane"
)

// plane.Edge on the open internet: host's A and AAAA at the zone's provider, at the control node's addresses
// as asked at the moment of the call. The proxy on that node serves every host under *.<zone>.
type Public struct {
	Zone *dns.Zone
	// Whether a host is one this cluster computes; no other name is written.
	Owns func(host string) bool
	// The mark its records carry, naming.Cluster.Owner.
	Owner     string
	Addresses func(ctx context.Context) ([]string, error)
}

var _ plane.Edge = Public{}

func (p Public) Route(ctx context.Context, host string) error {
	if !p.Owns(host) {
		return fmt.Errorf("%s is not a host of this cluster", host)
	}
	ips, err := p.Addresses(ctx)
	if err != nil {
		return err
	}
	_, err = p.Zone.Point(host, ips, p.Owner)
	return err
}

func (p Public) Check(ctx context.Context, host string) error {
	ips, err := p.Addresses(ctx)
	if err != nil {
		return err
	}
	return p.Zone.Check(host, ips, p.Owner)
}
