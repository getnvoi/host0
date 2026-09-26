// Every name a cluster owns, computed from its own name. Nothing here is stored.
package naming

import (
	"fmt"
	"regexp"
)

const (
	Label     = "nvoi.cluster"
	NetRange  = "10.0.0.0/16"
	Subnet    = "10.0.1.0/24"
	ControlIP = "10.0.1.2"
	// Images pushed from the laptop are named localhost:RegistryPort; atelet and containerd map it to Registry.
	RegistryPort = 15001
	Registry     = ControlIP + ":5001"
	Namespace    = "nvoi-system"
)

type Cluster struct{ Name string }

var valid = regexp.MustCompile(`^[a-z][a-z0-9-]{0,20}$`)

func New(name string) (Cluster, error) {
	if !valid.MatchString(name) {
		return Cluster{}, fmt.Errorf("cluster name %q: lowercase letters, digits and dashes, 21 at most", name)
	}
	return Cluster{name}, nil
}

func (c Cluster) Prefix() string  { return "nvoi-" + c.Name }
func (c Cluster) Control() string { return c.Prefix() + "-control" }

// The Cloudflare tunnel: a name no other tool picks, since tunnels carry no labels and one found by name is ours.
func (c Cluster) Tunnel() string   { return "nvoi-cluster-" + c.Name }
func (c Cluster) Selector() string { return Label + "=" + c.Name }
func (c Cluster) Labels() map[string]string {
	return map[string]string{Label: c.Name}
}

// One label under the zone, which the zone's universal certificate covers.
func Host(c Cluster, name, zone string) string { return fmt.Sprintf("%s-%s.%s", name, c.Name, zone) }

func LocalRegistry() string { return fmt.Sprintf("localhost:%d", RegistryPort) }
