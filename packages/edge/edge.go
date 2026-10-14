// Where a cluster's hosts reach it: Cloudflare's tunnel, or records at the control node and a proxy there.
package edge

import (
	"context"

	"github.com/getnvoi/host0/shared/naming"
)

// What the install drives; cloudflare and dns implement it.
type Edge interface {
	// tcp ports the control node opens to the world, beyond ssh.
	Ports() []int
	// Points hosts at the cluster, every request going to service; returns the Secrets, by name, its Deployment reads.
	Serve(ctx context.Context, c naming.Cluster, service string, hosts []string) (map[string]map[string]string, error)
	// The Deployment that runs it in naming.Namespace, from infra's manifests/<Deployment>.yaml.
	Deployment() string
	// Reads the zone with the given credentials; install runs it before anything is created.
	Reach(ctx context.Context) error
	// The cluster's records in the zone now, one line each: name, type, value.
	Records(ctx context.Context, c naming.Cluster) ([]string, error)
	Destroy(ctx context.Context, c naming.Cluster) error
}
