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
	"github.com/getnvoi/host0/dns"
	"github.com/getnvoi/host0/hetzner"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/ssh"
	"github.com/getnvoi/host0/infra/steps"
	"github.com/getnvoi/host0/shared/naming"
)

var _ infra.Edge = dns.Edge{}

const (
	dnsHelp = "dnscontrol provider holding the zone: CLOUDFLAREAPI, ROUTE53, GANDI_V5, OVH, HETZNER_V2, ... " +
		"Each of its creds.json keys is read from the shell variable dnscontrol names for it (ROUTE53 KeyId: AWS_ACCESS_KEY_ID), " +
		"else <TYPE>_<KEY> uppercased (GANDI_V5 token: GANDI_V5_TOKEN); CLOUDFLAREAPI apitoken: CLOUDFLARE_API_TOKEN. " +
		"-f maps keys to variables explicitly"
	edgeHelp = "tunnel: Cloudflare's tunnel, --dns CLOUDFLAREAPI only; public: A/AAAA records at the control node and TLS " +
		"for *.<zone> on its 80/443. Default: tunnel on CLOUDFLAREAPI, public otherwise"
)

type options struct {
	file     string
	cfg      infra.Config
	edge     string
	provider string
	key      string
	only     []string
}

// Flags both install and destroy take.
func common(c *cobra.Command, o *options) {
	f := c.Flags()
	f.StringVarP(&o.file, "file", "f", "", "cluster.yml; a flag given overrides it")
	f.StringVar(&o.cfg.Zone, "zone", "", "zone the cluster's hosts are served under: <name>-<cluster>.<zone>")
	f.StringVar(&o.cfg.PreviewSuffix, "preview-suffix", "-preview", "previews are <name>-<cluster><suffix>.<zone>")
	f.StringVar(&o.edge, "edge", "", edgeHelp)
	f.StringVar(&o.provider, "dns", "CLOUDFLAREAPI", dnsHelp)
}

func Cluster() *cobra.Command {
	cmd := &cobra.Command{Use: "cluster", Short: "Install or destroy a cluster"}
	var o options
	install := &cobra.Command{
		Use:   "install [name]",
		Short: "Hetzner servers, k3s, Substrate, autoscaling and the edge: Cloudflare's tunnel or public records and TLS",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := env(c, args, o, true)
			if err != nil {
				return err
			}
			return infra.Run(c.Context(), e, steps.Install, o.only...)
		},
	}
	common(install, &o)
	f := install.Flags()
	f.StringVar(&o.cfg.Location, "location", "", "cloud location (Hetzner: fsn1)")
	f.StringVar(&o.cfg.ControlType, "control-type", "", "control node server type (Hetzner: ccx23)")
	f.StringVar(&o.cfg.WorkerType, "worker-type", "", "worker server type, one for all: a snapshot is tied to its CPU (Hetzner: ccx23)")
	f.IntVar(&o.cfg.WorkerMax, "worker-max", 10, "most workers the autoscaler makes")
	f.StringVar(&o.key, "ssh-key", "~/.ssh/id_ed25519", "private key; its .pub is installed on every node")
	f.StringSliceVar(&o.only, "only", nil, "run only these steps, by name")

	destroy := &cobra.Command{
		Use:   "destroy [name]",
		Short: "Every server, network, firewall and key labelled with the cluster, and its tunnel or its records",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := env(c, args, o, false)
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
	common(destroy, &o)

	cmd.AddCommand(install, destroy)
	cmd.PersistentPreRun = func(c *cobra.Command, _ []string) {
		ctx, _ := signal.NotifyContext(context.Background(), os.Interrupt)
		c.SetContext(ctx)
	}
	return cmd
}

// Fills what a flag left unset from the file.
func merge(c *cobra.Command, o *options, f File) {
	str := func(flag string, dst *string, v string) {
		if c.Flags().Lookup(flag) != nil && !c.Flags().Changed(flag) && v != "" {
			*dst = v
		}
	}
	str("zone", &o.cfg.Zone, f.Edge.Zone)
	str("preview-suffix", &o.cfg.PreviewSuffix, f.Edge.PreviewSuffix)
	str("edge", &o.edge, f.Edge.Mode)
	str("dns", &o.provider, f.DNS.Provider)
	str("location", &o.cfg.Location, f.Cloud.Location)
	str("control-type", &o.cfg.ControlType, f.Cloud.Control)
	str("worker-type", &o.cfg.WorkerType, f.Cloud.Worker)
	if c.Flags().Lookup("worker-max") != nil && !c.Flags().Changed("worker-max") && f.Cloud.WorkerMax != 0 {
		o.cfg.WorkerMax = f.Cloud.WorkerMax
	}
}

func env(c *cobra.Command, args []string, o options, install bool) (*infra.Env, error) {
	var file File
	if o.file != "" {
		var err error
		if file, err = Load(o.file); err != nil {
			return nil, err
		}
		merge(c, &o, file)
	}
	name := file.Name
	if len(args) == 1 {
		name = args[0]
	}
	if name == "" {
		return nil, fmt.Errorf("the cluster's name: an argument, or name in -f")
	}
	cluster, err := naming.New(name)
	if err != nil {
		return nil, err
	}
	if o.cfg.Zone == "" {
		return nil, fmt.Errorf("the zone: --zone, or edge.zone in -f")
	}
	if p := file.Cloud.Provider; p != "" && p != "hetzner" {
		return nil, fmt.Errorf("%s: cloud.provider %q: hetzner is the one cloud", o.file, p)
	}
	cloudVars := file.Cloud.Credentials
	if cloudVars == nil {
		cloudVars = map[string]string{"token": "HCLOUD_TOKEN"}
	}
	cloudCreds, err := dns.Read(cloudVars, os.Getenv, true)
	if err != nil {
		return nil, err
	}
	if o.cfg.HcloudToken = cloudCreds["token"]; o.cfg.HcloudToken == "" {
		return nil, fmt.Errorf("%s: cloud.credentials has no token", o.file)
	}

	home, _ := os.UserHomeDir()
	if install {
		path := strings.Replace(o.key, "~", home, 1)
		if o.cfg.PrivateKey, err = os.ReadFile(path); err != nil {
			return nil, err
		}
		pub, err := os.ReadFile(path + ".pub")
		if err != nil {
			return nil, err
		}
		o.cfg.PublicKey = strings.TrimSpace(string(pub))
	}
	cache := filepath.Join(home, ".hz", "cache")
	if err := os.MkdirAll(cache, 0o700); err != nil {
		return nil, err
	}
	say := func(f string, a ...any) { fmt.Fprintf(os.Stdout, "  "+f+"\n", a...) }
	cloud := hetzner.Client{Token: o.cfg.HcloudToken, Say: say}
	d := cloud.Defaults()
	for _, v := range []struct {
		dst *string
		def string
	}{
		{&o.cfg.Location, d.Location}, {&o.cfg.ControlType, d.ControlType}, {&o.cfg.WorkerType, d.WorkerType},
	} {
		if *v.dst == "" {
			*v.dst = v.def
		}
	}
	edge, err := selectEdge(o, file, say, func(ctx context.Context) ([]string, error) {
		s, err := cloud.Lookup(ctx, cluster.Control())
		if err != nil {
			return nil, err
		}
		ips := []string{s.PublicIP}
		if s.PublicIPv6 != "" {
			ips = append(ips, s.PublicIPv6)
		}
		return ips, nil
	})
	if err != nil {
		return nil, err
	}
	return &infra.Env{
		Cluster: cluster,
		Config:  o.cfg,
		Cloud:   cloud,
		Edge:    edge,
		Dial: func(ctx context.Context, addr string) (infra.Shell, error) {
			return ssh.Dial(ctx, addr, o.cfg.PrivateKey)
		},
		Out:    os.Stdout,
		Cache:  cache,
		Source: source(),
		Vars:   map[string]string{},
	}, nil
}

// The edge --edge names, on the zone's provider with its credentials from the shell.
func selectEdge(o options, file File, say func(string, ...any), address func(context.Context) ([]string, error)) (infra.Edge, error) {
	def, err := dns.Provider(o.provider)
	if err != nil {
		return nil, err
	}
	vars, all := file.DNS.Credentials, true
	if vars == nil {
		if vars, err = dns.Vars(def.TypeName); err != nil {
			return nil, err
		}
		all = false
	}
	creds, err := dns.Read(vars, os.Getenv, all)
	if err != nil {
		return nil, fmt.Errorf("dns %s: %w", def.TypeName, err)
	}
	mode := o.edge
	if mode == "" {
		mode = "public"
		if def.TypeName == "CLOUDFLAREAPI" {
			mode = "tunnel"
		}
	}
	switch mode {
	case "tunnel":
		if def.TypeName != "CLOUDFLAREAPI" {
			return nil, fmt.Errorf("--edge tunnel is Cloudflare's tunnel: it needs --dns CLOUDFLAREAPI, not %s; --edge public serves any provider", def.TypeName)
		}
		if creds["apitoken"] == "" {
			return nil, fmt.Errorf("--edge tunnel needs a Cloudflare API token: apitoken, from %s", vars["apitoken"])
		}
		return cloudflare.Client{Token: creds["apitoken"], Zone: o.cfg.Zone, Suffix: o.cfg.PreviewSuffix, Say: say}, nil
	case "public":
		return dns.Edge{Provider: def.TypeName, Creds: creds, Zone: o.cfg.Zone, Suffix: o.cfg.PreviewSuffix,
			Address: address, Say: say}, nil
	}
	return nil, fmt.Errorf("--edge %q: tunnel or public", mode)
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
