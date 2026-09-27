package local

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cloudflare"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/steps"
	"github.com/getnvoi/host0/shared/naming"
)

// hz on this machine: a kind cluster in Docker in place of Hetzner servers, and above it the same install as
// cluster install: Substrate, the worker pools, the Cloudflare tunnel, the plane at https://app-<name>.<zone>.
func Machine() *cobra.Command {
	cmd := &cobra.Command{Use: "local", Short: "Run a cluster on this machine, in kind, behind the zone's Cloudflare tunnel"}
	var cfg infra.Config
	var name string
	var only []string
	flags := func(c *cobra.Command) {
		c.Flags().StringVar(&cfg.Zone, "zone", "", "Cloudflare zone its hosts are served under")
		c.Flags().StringVar(&name, "name", "local", "the cluster's name: its hosts are app-<name>.<zone>, its tunnel hz-cluster-<name>")
		c.Flags().StringVar(&cfg.PreviewSuffix, "preview-suffix", "-preview", "previews are <id>-<name><suffix>.<zone>")
		_ = c.MarkFlagRequired("zone")
	}
	env := func() (*infra.Env, error) {
		cluster, err := naming.New(name)
		if err != nil {
			return nil, err
		}
		if cfg.CFToken = os.Getenv("CLOUDFLARE_API_TOKEN"); cfg.CFToken == "" {
			return nil, fmt.Errorf("CLOUDFLARE_API_TOKEN is not set")
		}
		cache, err := cacheDir()
		if err != nil {
			return nil, err
		}
		say := func(f string, a ...any) { fmt.Fprintf(os.Stdout, "  "+f+"\n", a...) }
		return &infra.Env{
			Cluster: cluster,
			Config:  cfg,
			Edge:    cloudflare.Client{Token: cfg.CFToken, Zone: cfg.Zone, Suffix: cfg.PreviewSuffix, Say: say},
			Out:     os.Stdout,
			Cache:   cache,
			Source:  source(),
			Vars:    map[string]string{"local": "1", "platform": "linux/" + runtime.GOARCH},
		}, nil
	}
	up := &cobra.Command{
		Use:   "up",
		Short: "Create or update the kind cluster and install hz on it; point this CLI at it",
		Args:  cobra.NoArgs,
		RunE: func(c *cobra.Command, _ []string) error {
			e, err := env()
			if err != nil {
				return err
			}
			return infra.Run(c.Context(), e, steps.Local, only...)
		},
	}
	flags(up)
	up.Flags().StringSliceVar(&only, "only", nil, "run only these steps, by name")
	down := &cobra.Command{
		Use:   "down",
		Short: "Remove the kind cluster, its registry, its tunnel and its records",
		Args:  cobra.NoArgs,
		RunE: func(c *cobra.Command, _ []string) error {
			e, err := env()
			if err != nil {
				return err
			}
			if err := steps.LocalDown(c.Context(), e.Cache, os.Stdout); err != nil {
				return err
			}
			return e.Edge.Destroy(c.Context(), e.Cluster)
		},
	}
	flags(down)
	cmd.AddCommand(up, down)
	return cmd
}

func cacheDir() (string, error) {
	home, _ := os.UserHomeDir()
	cache := filepath.Join(home, ".hz", "cache")
	return cache, os.MkdirAll(cache, 0o700)
}
