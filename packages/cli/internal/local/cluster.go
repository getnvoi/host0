// The local commands: they hold the cloud credentials, because the cluster they act on is not there yet or is going.
package local

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cloudflare"
	"github.com/getnvoi/host0/hetzner"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/ssh"
	"github.com/getnvoi/host0/infra/steps"
	"github.com/getnvoi/host0/shared/naming"
)

func Cluster() *cobra.Command {
	cmd := &cobra.Command{Use: "cluster", Short: "Install or destroy a cluster"}
	var cfg infra.Config
	var key string
	var only []string
	install := &cobra.Command{
		Use:   "install <name>",
		Short: "Hetzner servers, k3s, Substrate, autoscaling and the Cloudflare tunnel",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := env(args[0], &cfg, key, true)
			if err != nil {
				return err
			}
			return infra.Run(c.Context(), e, steps.Install, only...)
		},
	}
	f := install.Flags()
	f.StringVar(&cfg.Zone, "zone", "", "Cloudflare zone previews are served under")
	f.StringVar(&cfg.PreviewSuffix, "preview-suffix", "-preview", "previews are <name>-<cluster><suffix>.<zone>")
	f.StringVar(&cfg.Location, "location", "", "cloud location (Hetzner: fsn1)")
	f.StringVar(&cfg.ControlType, "control-type", "", "control node server type (Hetzner: ccx23)")
	f.StringVar(&cfg.WorkerType, "worker-type", "", "worker server type, one for all: a snapshot is tied to its CPU (Hetzner: ccx23)")
	f.IntVar(&cfg.WorkerMax, "worker-max", 10, "most workers the autoscaler makes")
	f.StringVar(&key, "ssh-key", "~/.ssh/id_ed25519", "private key; its .pub is installed on every node")
	f.StringSliceVar(&only, "only", nil, "run only these steps, by name")
	_ = install.MarkFlagRequired("zone")

	destroy := &cobra.Command{
		Use:   "destroy <name>",
		Short: "Every server, network, firewall and key labelled with the cluster, and its tunnel",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := env(args[0], &cfg, "", false)
			if err != nil {
				return err
			}
			// Servers first: the tunnel cannot go while its connectors, which run on them, are connected.
			if err := e.Cloud.Destroy(c.Context(), e.Cluster); err != nil {
				return err
			}
			return e.Edge.Destroy(c.Context(), e.Cluster)
		},
	}
	destroy.Flags().StringVar(&cfg.Zone, "zone", "", "Cloudflare zone the cluster served under")
	destroy.Flags().StringVar(&cfg.PreviewSuffix, "preview-suffix", "-preview", "the suffix it was installed with")
	_ = destroy.MarkFlagRequired("zone")

	cmd.AddCommand(install, destroy)
	cmd.PersistentPreRun = func(c *cobra.Command, _ []string) {
		ctx, _ := signal.NotifyContext(context.Background(), os.Interrupt)
		c.SetContext(ctx)
	}
	return cmd
}

func env(name string, cfg *infra.Config, key string, install bool) (*infra.Env, error) {
	cluster, err := naming.New(name)
	if err != nil {
		return nil, err
	}
	for _, v := range []struct {
		dst *string
		env string
	}{{&cfg.HcloudToken, "HCLOUD_TOKEN"}, {&cfg.CFToken, "CLOUDFLARE_API_TOKEN"}} {
		if *v.dst = os.Getenv(v.env); *v.dst == "" {
			return nil, fmt.Errorf("%s is not set", v.env)
		}
	}
	home, _ := os.UserHomeDir()
	if install {
		path := strings.Replace(key, "~", home, 1)
		if cfg.PrivateKey, err = os.ReadFile(path); err != nil {
			return nil, err
		}
		pub, err := os.ReadFile(path + ".pub")
		if err != nil {
			return nil, err
		}
		cfg.PublicKey = strings.TrimSpace(string(pub))
	}
	cache := filepath.Join(home, ".hz", "cache")
	if err := os.MkdirAll(cache, 0o700); err != nil {
		return nil, err
	}
	say := func(f string, a ...any) { fmt.Fprintf(os.Stdout, "  "+f+"\n", a...) }
	cloud := hetzner.Client{Token: cfg.HcloudToken, Say: say}
	d := cloud.Defaults()
	for _, v := range []struct {
		dst *string
		def string
	}{
		{&cfg.Location, d.Location}, {&cfg.ControlType, d.ControlType}, {&cfg.WorkerType, d.WorkerType},
	} {
		if *v.dst == "" {
			*v.dst = v.def
		}
	}
	return &infra.Env{
		Cluster: cluster,
		Config:  *cfg,
		Cloud:   cloud,
		Edge:    cloudflare.Client{Token: cfg.CFToken, Zone: cfg.Zone, Suffix: cfg.PreviewSuffix, Say: say},
		Dial: func(ctx context.Context, addr string) (infra.Shell, error) {
			return ssh.Dial(ctx, addr, cfg.PrivateKey)
		},
		Out:    os.Stdout,
		Cache:  cache,
		Source: source(),
		Vars:   map[string]string{},
	}, nil
}

// The checkout this binary was built from: bin/hz sits beside go.work.
func source() string {
	exe, _ := os.Executable()
	exe, _ = filepath.EvalSymlinks(exe)
	for dir := filepath.Dir(exe); dir != "/"; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return dir
		}
	}
	return "."
}
