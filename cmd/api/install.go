package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/cloud/hetzner"
	"github.com/getnvoi/host0/internal/edge/cloudflare"
	"github.com/getnvoi/host0/internal/infra"
	"github.com/getnvoi/host0/internal/infra/ssh"
	"github.com/getnvoi/host0/internal/infra/steps"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/naming"
)

// What h0 cluster install is told, the hub's way: Hetzner and the tunnel on the hub's zone.
type installer struct {
	HetznerToken, CloudflareToken, Zone string
	// The private key whose .pub goes on every node.
	SSHKey string
	// The checkout ko builds the plane and boxd from; the cache h0 keeps its sources in.
	Source, Cache string
}

// The cluster install, the same steps h0 cluster install runs: on a workspace that has one, it converges.
func (i installer) install(ctx context.Context, w Workspace, l infra.Laptop, out io.Writer) error {
	e, err := i.env(w, l, out)
	if err != nil {
		return err
	}
	return infra.Run(ctx, e, steps.Install)
}

// Every server, network and firewall the cluster owns, then its tunnel and records, as h0 cluster destroy.
func (i installer) destroy(ctx context.Context, w Workspace, out io.Writer) error {
	e, err := i.env(w, nil, out)
	if err != nil {
		return err
	}
	defer e.Close()
	fmt.Fprintf(out, "[1/2] servers\n")
	if err := e.Cloud.Destroy(ctx, e.Cluster); err != nil {
		return fmt.Errorf("servers: %w", err)
	}
	fmt.Fprintf(out, "[2/2] edge\n")
	if err := e.Edge.Destroy(ctx, e.Cluster); err != nil {
		return fmt.Errorf("edge: %w", err)
	}
	return nil
}

func (i installer) env(w Workspace, l infra.Laptop, out io.Writer) (*infra.Env, error) {
	cluster, err := naming.New(w.Name)
	if err != nil {
		return nil, err
	}
	say := func(f string, a ...any) { fmt.Fprintf(out, "  "+f+"\n", a...) }
	creds := map[string]string{"token": i.HetznerToken}
	cl, err := hetzner.Provider.New(creds, w.Location, say)
	if err != nil {
		return nil, err
	}
	key, err := os.ReadFile(i.SSHKey)
	if err != nil {
		return nil, fmt.Errorf("the hub's ssh key: %w", err)
	}
	pub, err := os.ReadFile(i.SSHKey + ".pub")
	if err != nil {
		return nil, fmt.Errorf("the hub's ssh key: %w", err)
	}
	cfg := infra.Config{
		Location: w.Location, ControlType: w.Plan, WorkerType: w.Plan, WorkerMax: 5, WorkerIdle: 10 * time.Minute,
		Actors: sandbox.Rest{Pause: 10 * time.Minute, Suspend: 60 * time.Minute}, Tiers: sandbox.DefaultTiers,
		Zone: i.Zone, PreviewSuffix: "-preview", Arch: hetzner.Provider.Defaults.Arch,
		PublicKey: strings.TrimSpace(string(pub)), PrivateKey: key,
	}
	return &infra.Env{
		Cluster:    cluster,
		Config:     cfg,
		Cloud:      cl,
		CloudCreds: creds,
		Edge:       cloudflare.Client{Token: i.CloudflareToken, Zone: i.Zone, Suffix: cfg.PreviewSuffix, Say: say},
		Dial: func(ctx context.Context, addr string) (infra.Shell, error) {
			return ssh.Dial(ctx, addr, key)
		},
		Laptop: l,
		Out:    out,
		Cache:  i.Cache,
		Source: i.Source,
		Vars:   map[string]string{},
	}, nil
}
