// The local commands: they hold the cloud credentials, because the cluster they act on is not there yet or is going.
package local

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/cloud/clouds"
	"github.com/getnvoi/host0/cloudflare"
	"github.com/getnvoi/host0/dns"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/ssh"
	"github.com/getnvoi/host0/infra/steps"
	"github.com/getnvoi/host0/shared/naming"
	"github.com/getnvoi/host0/shared/state"
	"github.com/getnvoi/host0/shared/tiers"
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
	cloud    string
	file     string
	cfg      infra.Config
	edge     string
	provider string
	key      string
	only     []string
	keepCert bool
	tiers    []string
	// Credential key to shell variable, as the file's credentials.
	cloudVars, dnsVars map[string]string
}

// Flags both install and destroy take.
func common(c *cobra.Command, o *options) {
	f := c.Flags()
	f.StringVarP(&o.file, "file", "f", "", "cluster.yml; a flag given overrides it")
	f.StringVar(&o.cfg.Zone, "zone", "", "zone the cluster's hosts are served under: <name>-<cluster>.<zone>")
	f.StringVar(&o.cfg.PreviewSuffix, "preview-suffix", "-preview", "previews are <name>-<cluster><suffix>.<zone>")
	f.StringVar(&o.edge, "edge", "", edgeHelp)
	f.StringVar(&o.provider, "dns", "CLOUDFLAREAPI", dnsHelp)
	f.StringVar(&o.cloud, "cloud", "hetzner", cloudHelp())
	f.StringVar(&o.cfg.Location, "location", "", "cloud location; the cloud's default when empty")
	f.StringToStringVar(&o.cloudVars, "cloud-credentials", nil, "key=VARIABLE for each of the cloud's credentials; replaces cloud.credentials")
	f.StringToStringVar(&o.dnsVars, "dns-credentials", nil, "key=VARIABLE for each of the DNS provider's credentials; replaces dns.credentials")
}

// Flags install alone takes.
func installFlags(c *cobra.Command, o *options) {
	f := c.Flags()
	f.StringVar(&o.cfg.ControlType, "control-type", "", "control node server type; the cloud's default when empty")
	f.StringVar(&o.cfg.WorkerType, "worker-type", "", "worker server type, one for all: a snapshot is tied to its CPU; the cloud's default when empty")
	f.IntVar(&o.cfg.WorkerMax, "worker-max", 5, "most worker servers the plane makes")
	f.DurationVar(&o.cfg.WorkerIdle, "worker-idle", 10*time.Minute, "a worker server with no actor this long is deleted")
	f.StringArrayVar(&o.tiers, "tier", nil, "a sandbox size, name:cpu:memory[:default], once per tier; replaces the file's tiers. "+
		"Default: small 1:2Gi, medium 2:4Gi (default), large 4:8Gi")
	f.StringVar(&o.key, "ssh-key", "~/.ssh/id_ed25519", "private key; its .pub is installed on every node")
	f.StringSliceVar(&o.only, "only", nil, "run only these steps, by name")
}

// Each cloud with the shell variables its credentials are read from.
func cloudHelp() string {
	var each []string
	for _, p := range clouds.All {
		var vars []string
		for _, c := range p.Creds {
			vars = append(vars, c.Var+": "+c.Help)
		}
		each = append(each, p.Name+" ("+strings.Join(vars, "; ")+")")
	}
	return "cloud the servers are on: " + strings.Join(each, ", ") + "; -f cloud.credentials maps keys to other variables"
}

func Cluster() *cobra.Command {
	cmd := &cobra.Command{Use: "cluster", Short: "Install or destroy a cluster"}
	var o options
	install := &cobra.Command{
		Use:   "install [name]",
		Short: "Servers on a cloud, k3s, Substrate, the plane that makes its workers, and the edge: Cloudflare's tunnel or public records and TLS",
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
	installFlags(install, &o)

	destroy := &cobra.Command{
		Use:   "destroy [name]",
		Short: "Every server, network, firewall and key the cluster owns, and its tunnel or its records",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := env(c, args, o, o.keepCert)
			if err != nil {
				return err
			}
			var keep func(context.Context, *infra.Env) error
			if o.keepCert {
				keep = steps.KeepCerts
			}
			return teardown(c.Context(), e, keep)
		},
	}
	common(destroy, &o)
	destroy.Flags().BoolVar(&o.keepCert, "keep-cert", false, "development: keep the public edge's certificate at "+
		"~/.hz/certs/<zone>, sealed with ~/.hz/key, for the next install of the zone; it exists to stay under "+
		"Let's Encrypt's limits while iterating")
	destroy.Flags().StringVar(&o.key, "ssh-key", "~/.ssh/id_ed25519", "private key, for --keep-cert")

	records := &cobra.Command{
		Use:   "records [name]",
		Short: "The cluster's records in its zone, as the DNS provider holds them now",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := env(c, args, o, false)
			if err != nil {
				return err
			}
			rs, err := e.Edge.Records(c.Context(), e.Cluster)
			if err != nil {
				return err
			}
			if len(rs) == 0 {
				fmt.Printf("no records for %s in %s\n", e.Cluster.Name, e.Config.Zone)
			}
			for _, r := range rs {
				fmt.Println(r)
			}
			return nil
		},
	}
	common(records, &o)

	cmd.AddCommand(install, destroy, records)
	cmd.PersistentPreRun = func(c *cobra.Command, _ []string) {
		ctx, _ := signal.NotifyContext(context.Background(), os.Interrupt)
		c.SetContext(ctx)
	}
	return cmd
}

// keep, when set, runs while the servers are still there; a keep that fails stops the destroy.
func teardown(ctx context.Context, e *infra.Env, keep func(context.Context, *infra.Env) error) error {
	defer e.Close()
	if keep != nil {
		if err := keep(ctx, e); err != nil {
			return err
		}
	}
	// Servers first: the tunnel cannot go while its connectors, which run on them, are connected.
	if err := e.Cloud.Destroy(ctx, e.Cluster); err != nil {
		return err
	}
	if err := e.Edge.Destroy(ctx, e.Cluster); err != nil {
		return err
	}
	if _, err := os.Stat(state.KeyPath()); err == nil {
		e.Say("%s stays: it is the sealing key's backup, and an install restores it to the next cluster", state.KeyPath())
	}
	return nil
}

// Fills what a flag left unset from the file.
func merge(c *cobra.Command, o *options, f File) error {
	str := func(flag string, dst *string, v string) {
		if c.Flags().Lookup(flag) != nil && !c.Flags().Changed(flag) && v != "" {
			*dst = v
		}
	}
	str("zone", &o.cfg.Zone, f.Edge.Zone)
	str("preview-suffix", &o.cfg.PreviewSuffix, f.Edge.PreviewSuffix)
	str("edge", &o.edge, f.Edge.Mode)
	str("dns", &o.provider, f.DNS.Provider)
	str("cloud", &o.cloud, f.Cloud.Provider)
	if !c.Flags().Changed("cloud-credentials") && f.Cloud.Credentials != nil {
		o.cloudVars = f.Cloud.Credentials
	}
	if !c.Flags().Changed("dns-credentials") && f.DNS.Credentials != nil {
		o.dnsVars = f.DNS.Credentials
	}
	str("location", &o.cfg.Location, f.Cloud.Location)
	str("control-type", &o.cfg.ControlType, f.Control.Type)
	str("worker-type", &o.cfg.WorkerType, f.Workers.Type)
	unset := func(flag string) bool { return c.Flags().Lookup(flag) != nil && !c.Flags().Changed(flag) }
	if unset("worker-max") && f.Workers.Max != 0 {
		o.cfg.WorkerMax = f.Workers.Max
	}
	if unset("worker-idle") && f.Workers.Idle != "" {
		d, err := time.ParseDuration(f.Workers.Idle)
		if err != nil {
			return fmt.Errorf("workers.idle: %w", err)
		}
		o.cfg.WorkerIdle = d
	}
	return nil
}

// The tiers --tier gives, else the file's, else the defaults.
func tierList(o options, f File) ([]tiers.Tier, error) {
	ts := f.Tiers
	if len(o.tiers) > 0 {
		ts = nil
		for _, s := range o.tiers {
			t, err := parseTier(s)
			if err != nil {
				return nil, err
			}
			ts = append(ts, t)
		}
	}
	return resolve(ts)
}

func env(c *cobra.Command, args []string, o options, install bool) (*infra.Env, error) {
	var file File
	var err error
	if o.file != "" {
		if file, err = Load(o.file); err != nil {
			return nil, err
		}
		if err := merge(c, &o, file); err != nil {
			return nil, fmt.Errorf("%s: %w", o.file, err)
		}
	}
	if o.cfg.Tiers, err = tierList(o, file); err != nil {
		return nil, err
	}
	if o.cfg.WorkerMax < 0 || o.cfg.WorkerMax > 200 {
		return nil, fmt.Errorf("--worker-max %d: from 0 to 200", o.cfg.WorkerMax)
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
	provider, err := clouds.Find(o.cloud)
	if err != nil {
		return nil, err
	}
	say := func(f string, a ...any) { fmt.Fprintf(os.Stdout, "  "+f+"\n", a...) }

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
	d := provider.Defaults
	o.cfg.Arch = d.Arch
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
	cl, creds, err := openCloud(provider, o.cloudVars, o.cfg.Location, say)
	if err != nil {
		return nil, err
	}
	edge, err := selectEdge(o, say, func(ctx context.Context) ([]string, error) {
		s, err := cl.Lookup(ctx, cluster.Control())
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
		Cluster:    cluster,
		Config:     o.cfg,
		Cloud:      cl,
		CloudCreds: creds,
		Edge:       edge,
		Dial: func(ctx context.Context, addr string) (infra.Shell, error) {
			return ssh.Dial(ctx, addr, o.cfg.PrivateKey)
		},
		Out:    os.Stdout,
		Cache:  cache,
		Source: source(),
		Vars:   map[string]string{},
	}, nil
}

// The cloud with its credentials from the shell: from the variables vars names by key, else each Credential's Var.
func openCloud(p cloud.Provider, vars map[string]string, location string, say func(string, ...any)) (cloud.Cloud, map[string]string, error) {
	if vars == nil {
		vars = map[string]string{}
		for _, c := range p.Creds {
			vars[c.Key] = c.Var
		}
	}
	creds, err := dns.Read(vars, os.Getenv, true)
	if err != nil {
		return nil, nil, fmt.Errorf("cloud %s: %w", p.Name, err)
	}
	for _, c := range p.Creds {
		if creds[c.Key] == "" {
			return nil, nil, fmt.Errorf("cloud %s needs %s: %s", p.Name, c.Key, c.Help)
		}
	}
	cl, err := p.New(creds, location, say)
	return cl, creds, err
}

// The edge --edge names, on the zone's provider with its credentials from the shell.
func selectEdge(o options, say func(string, ...any), address func(context.Context) ([]string, error)) (infra.Edge, error) {
	def, err := dns.Provider(o.provider)
	if err != nil {
		return nil, err
	}
	vars, all := o.dnsVars, true
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
