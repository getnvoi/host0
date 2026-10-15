package local

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/h0/state"
	"github.com/getnvoi/host0/internal/edge/cloudflare"
	"github.com/getnvoi/host0/internal/infra"
	"github.com/getnvoi/host0/internal/infra/steps"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/naming"
)

// h0 on this machine: a kind cluster in Docker in place of Hetzner servers, and above it the same install as
// cluster install: Substrate, the worker pools, the Cloudflare tunnel, the plane at https://app-<name>.<zone>.
func Machine() *cobra.Command {
	cmd := &cobra.Command{Use: "local", Short: "Run a cluster on this machine, in kind, behind the zone's Cloudflare tunnel"}
	var cfg infra.Config
	var name string
	var only []string
	var edge, provider string
	flags := func(c *cobra.Command) {
		c.Flags().StringVar(&cfg.Zone, "zone", "", "Cloudflare zone its hosts are served under")
		c.Flags().StringVar(&name, "name", "local", "the cluster's name: its hosts are app-<name>.<zone>, its tunnel h0-cluster-<name>")
		c.Flags().StringVar(&cfg.PreviewSuffix, "preview-suffix", "-preview", "previews are <id>-<name><suffix>.<zone>")
		c.Flags().StringVar(&edge, "edge", "tunnel", "tunnel only: a kind cluster has no public address")
		c.Flags().StringVar(&provider, "dns", "CLOUDFLAREAPI", "CLOUDFLAREAPI only, the tunnel's")
		c.Flags().DurationVar(&cfg.Actors.Pause, "pause-after", 10*time.Minute, "an actor idle this long is paused")
		c.Flags().DurationVar(&cfg.Actors.Suspend, "suspend-after", 60*time.Minute, "an actor idle this long is suspended")
		_ = c.MarkFlagRequired("zone")
	}
	env := func() (*infra.Env, error) {
		cluster, err := naming.New(name)
		if err != nil {
			return nil, err
		}
		if edge != "tunnel" || !strings.EqualFold(provider, "CLOUDFLAREAPI") {
			return nil, fmt.Errorf("h0 local runs behind Cloudflare's tunnel only: a kind cluster has no public address for --edge %s --dns %s", edge, provider)
		}
		token := os.Getenv("CLOUDFLARE_API_TOKEN")
		if token == "" {
			return nil, fmt.Errorf("CLOUDFLARE_API_TOKEN is not set")
		}
		cache, err := cacheDir()
		if err != nil {
			return nil, err
		}
		say := func(f string, a ...any) { fmt.Fprintf(os.Stdout, "  "+f+"\n", a...) }
		return &infra.Env{
			Cluster: cluster,
			Config:  config(cfg),
			Edge:    cloudflare.Client{Token: token, Zone: cfg.Zone, Suffix: cfg.PreviewSuffix, Say: say},
			Laptop:  state.Laptop{},
			Out:     os.Stdout,
			Cache:   cache,
			Source:  source(),
			Vars:    map[string]string{"local": "1"},
		}, nil
	}
	up := &cobra.Command{
		Use:   "up",
		Short: "Create or update the kind cluster and install h0 on it; point this CLI at it",
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

// kind runs on this machine's arch, and its one node takes every pool: the plane makes no worker server.
func config(cfg infra.Config) infra.Config {
	cfg.Arch, cfg.Tiers = runtime.GOARCH, sandbox.DefaultTiers
	return cfg
}

func cacheDir() (string, error) {
	home, _ := os.UserHomeDir()
	cache := filepath.Join(home, ".h0", "cache")
	return cache, os.MkdirAll(cache, 0o700)
}
