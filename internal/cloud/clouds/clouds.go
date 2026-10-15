// Every cloud h0 runs on, by name: the cli installs on one, the plane makes its workers on the same.
package clouds

import (
	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/cloud/hetzner"
	"github.com/getnvoi/host0/internal/cloud/scaleway"
)

var All = []cloud.Provider{hetzner.Provider, scaleway.Provider}

func Find(name string) (cloud.Provider, error) { return cloud.Find(All, name) }
