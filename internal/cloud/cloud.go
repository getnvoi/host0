// What h0 asks of a cloud: a base, servers by name, and their teardown. Every provider passes conformance.
package cloud

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/getnvoi/host0/internal/shared/naming"
)

// ID is the provider's own, opaque outside it. PublicIPv6 is the address the provider reports, empty for none.
type Server struct{ ID, Name, PublicIP, PublicIPv6 string }

// Init is cloud-init user data, empty for none. The server is in its client's location.
type Spec struct{ Name, Type, PrivateIP, Init string }

// Arch is the servers' GOARCH.
type Defaults struct{ Location, ControlType, WorkerType, Arch string }

// Key is the provider's name for it, Var the shell variable it is read from by default.
type Credential struct{ Key, Var, Help string }

// A client is bound to one location: every call acts there.
type Cloud interface {
	Name() string
	// Network, firewall and ssh key, each named Cluster.Prefix(); the firewall lets in tcp Inbound(open) only.
	Base(ctx context.Context, c naming.Cluster, publicKey string, open []int) error
	// The server named s.Name, created when absent; an existing one is returned as it is.
	Server(ctx context.Context, c naming.Cluster, s Spec) (Server, error)
	// The server by name as it is now; an error naming it when there is none.
	Lookup(ctx context.Context, name string) (Server, error)
	// One server by name; absent is not an error.
	Delete(ctx context.Context, name string) error
	// The cluster's servers, by owner.
	List(ctx context.Context, c naming.Cluster) ([]Server, error)
	// What the node's spec.providerID must be.
	ProviderID(s Server) string
	// Shell run on the server that sets provider_id and external_ips (comma separated) from the cloud's metadata.
	// A server's id does not exist when its Init is written.
	Identity() string
	Destroy(ctx context.Context, c naming.Cluster) error
}

type Provider struct {
	Name  string
	Creds []Credential
	// What a cluster gets when its file leaves them out; known before a location is chosen.
	Defaults Defaults
	New      func(creds map[string]string, location string, say func(string, ...any)) (Cloud, error)
}

// The provider named name among ps.
func Find(ps []Provider, name string) (Provider, error) {
	var names []string
	for _, p := range ps {
		if p.Name == name {
			return p, nil
		}
		names = append(names, p.Name)
	}
	return Provider{}, fmt.Errorf("no cloud %q: %s", name, strings.Join(names, ", "))
}

// tcp 22 and each of open, sorted, once each.
func Inbound(open []int) []int {
	return slices.Compact(slices.Sorted(slices.Values(append([]int{22}, open...))))
}
