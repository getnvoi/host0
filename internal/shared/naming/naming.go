// Every name a cluster owns, computed from its own name. Nothing here is stored.
package naming

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const (
	Subnet    = "10.0.1.0/24"
	ControlIP = "10.0.1.2"
	// Images pushed from the laptop are named localhost:RegistryPort; atelet and containerd map it to Registry.
	RegistryPort = 15001
	Registry     = ControlIP + ":5001"
	Namespace    = "h0-system"
	// The Secret in Namespace holding the public edge's ACME account and certificates.
	Certs = "proxy-certs"
	// Every worker carries the taint; only sandbox workers and atelet land there.
	WorkerTaint = "ate.dev/sandboxClass"
)

type Cluster struct{ Name string }

var valid = regexp.MustCompile(`^[a-z][a-z0-9-]{0,20}$`)

func New(name string) (Cluster, error) {
	if !valid.MatchString(name) {
		return Cluster{}, fmt.Errorf("cluster name %q: lowercase letters, digits and dashes, 21 at most", name)
	}
	return Cluster{name}, nil
}

func (c Cluster) Prefix() string  { return "h0-" + c.Name }
func (c Cluster) Control() string { return c.Prefix() + "-control" }

// Worker n's server and node; every pool shares the workers, so the name holds no pool.
func (c Cluster) Worker(n int) string { return fmt.Sprintf("%s-w%d", c.Prefix(), n) }

// n when name is Worker(n).
func (c Cluster) WorkerIndex(name string) (int, bool) {
	rest, ok := strings.CutPrefix(name, c.Prefix()+"-w")
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(rest)
	return n, err == nil && n > 0 && c.Worker(n) == name
}

// Worker n's address on the private network.
func WorkerIP(n int) string { return fmt.Sprintf("10.0.1.%d", 10+n) }

// The TXT value that marks a DNS record as this cluster's, as h0/owner marks its other objects.
func (c Cluster) Owner() string { return "h0/owner=" + c.Prefix() }

// The Cloudflare tunnel: a name no other tool picks, since tunnels carry no labels and one found by name is ours.
func (c Cluster) Tunnel() string { return "h0-cluster-" + c.Name }

// One label under the zone, which the zone's universal certificate covers.
func Host(c Cluster, name, zone string) string { return fmt.Sprintf("%s-%s.%s", name, c.Name, zone) }

// Whether host is one Host or a preview computes for c under zone: <name>-<cluster>[<suffix>].<zone>, name one label.
func Owns(c Cluster, suffix, zone, host string) bool {
	label, ok := strings.CutSuffix(strings.ToLower(strings.TrimSuffix(host, ".")), "."+strings.ToLower(zone))
	if !ok || strings.Contains(label, ".") {
		return false
	}
	for _, tail := range []string{"-" + c.Name, "-" + c.Name + suffix} {
		if name, ok := strings.CutSuffix(label, tail); ok && name != "" {
			return true
		}
	}
	return false
}

func LocalRegistry() string { return fmt.Sprintf("localhost:%d", RegistryPort) }
