// The plane, in the cluster. Everything it is told comes from its environment, which the install writes.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/cloud/clouds"

	"github.com/getnvoi/host0/controlplane"
	"github.com/getnvoi/host0/controlplane/edge"
	"github.com/getnvoi/host0/controlplane/forge"
	"github.com/getnvoi/host0/controlplane/kube"
	"github.com/getnvoi/host0/controlplane/store"
	"github.com/getnvoi/host0/controlplane/substrate"
	"github.com/getnvoi/host0/dns"
	"github.com/getnvoi/host0/shared/naming"
)

func must(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("%s is required", name)
	}
	return v
}

func duration(name string, def time.Duration) time.Duration {
	if d, err := time.ParseDuration(os.Getenv(name)); err == nil {
		return d
	}
	return def
}

func main() {
	sb, err := substrate.New(substrate.Config{
		API:       "api.ate-system.svc.cluster.local:443",
		Authority: "api.ate-system.svc",
		CAFile:    "/run/servicedns-ca/trust-bundle.pem",
		TokenFile: "/var/run/secrets/ateapi/token",
		Router:    "atenet-router.ate-system.svc.cluster.local:8081",
		Atespace:  "hz",
		Snapshots: "gs://ate-snapshots/hz/",
	})
	if err != nil {
		log.Fatalf("substrate: %v", err)
	}
	pools, err := kube.InCluster("hz")
	if err != nil {
		log.Fatalf("kube: %v", err)
	}
	// The sealing key, mounted from the plane secret's seal by the install.
	key, err := os.ReadFile("/etc/hz/seal")
	if err != nil {
		log.Fatalf("sealing key: %v", err)
	}
	st, err := store.Open("/var/lib/hz", key)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	cluster, zone := must("HZ_CLUSTER"), must("HZ_ZONE")
	cl, init, err := workers("/etc/hz/cloud")
	if err != nil {
		log.Fatalf("cloud: %v", err)
	}
	p := &controlplane.Plane{
		Sandboxes:    sb,
		Pools:        pools,
		Pods:         pools,
		Cloud:        cl,
		WorkerInit:   init,
		Store:        st,
		Edge:         selectEdge(pools, cluster, zone),
		Forge:        forge.GitHub{},
		Pin:          controlplane.PinDockerHub,
		BoxImage:     must("HZ_BOXD_IMAGE"),
		BoxToken:     must("HZ_BOX_TOKEN"),
		Cluster:      cluster,
		Zone:         zone,
		Suffix:       must("HZ_PREVIEW_SUFFIX"),
		PauseAfter:   duration("HZ_PAUSE_AFTER", 10*time.Minute),
		SuspendAfter: duration("HZ_SUSPEND_AFTER", 60*time.Minute),
	}
	api, app := p.Host("api"), p.Host("app")
	for _, h := range []string{api, app} {
		go route(p.Edge, h)
	}
	p.Recover()
	go p.Refresh()
	go p.Scale(context.Background())
	go p.Sample(context.Background())
	log.Printf("plane on :8080, api at %s, app at %s", controlplane.Origin(api), controlplane.Origin(app))
	srv := &http.Server{Addr: ":8080", Handler: p.Handler(api, app, must("HZ_TOKEN_SHA256")),
		ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	log.Fatal(srv.ListenAndServe())
}

// The cloud the plane makes worker servers on, from the Secret install mounts at dir; none on a cluster without one.
func workers(dir string) (func(location string) (cloud.Cloud, error), string, error) {
	name, err := os.ReadFile(filepath.Join(dir, "provider"))
	if errors.Is(err, fs.ErrNotExist) {
		log.Printf("no %s: worker servers are not made, the cluster's nodes are all it has", dir)
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	provider, err := clouds.Find(string(name))
	if err != nil {
		return nil, "", err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "credentials"))
	if err != nil {
		return nil, "", err
	}
	var creds map[string]string
	if err := json.Unmarshal(raw, &creds); err != nil {
		return nil, "", fmt.Errorf("%s/credentials: %w", dir, err)
	}
	init, err := os.ReadFile(filepath.Join(dir, "worker-init"))
	if err != nil {
		return nil, "", err
	}
	say := func(f string, a ...any) { log.Printf("cloud: "+f, a...) }
	return func(location string) (cloud.Cloud, error) { return provider.New(creds, location, say) }, string(init), nil
}

// The host's record, retried until it is made: an edge that is down at boot does not keep the plane down.
func route(edge controlplane.Edge, host string) {
	for wait := 5 * time.Second; ; wait = min(2*wait, 5*time.Minute) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		err := edge.Route(ctx, host)
		cancel()
		if err == nil {
			return
		}
		log.Printf("route %s: %v; again in %s", host, err, wait)
		time.Sleep(wait)
	}
}

// The edge the install deployed beside the plane, named by its Deployment.
func selectEdge(k *kube.Client, cluster, zone string) controlplane.Edge {
	switch e := must("HZ_EDGE"); e {
	case "cloudflared":
		return edge.Cloudflare{Token: must("CLOUDFLARE_API_TOKEN"), Zone: zone, TunnelToken: must("TUNNEL_TOKEN")}
	case "proxy":
		var creds map[string]string
		if err := json.Unmarshal([]byte(must("HZ_DNS_CREDS")), &creds); err != nil {
			log.Fatalf("HZ_DNS_CREDS: %v", err)
		}
		z, err := dns.Open(must("HZ_DNS_PROVIDER"), creds, zone)
		if err != nil {
			log.Fatal(err)
		}
		c, err := naming.New(cluster)
		if err != nil {
			log.Fatal(err)
		}
		suffix, node := must("HZ_PREVIEW_SUFFIX"), must("HZ_NODE")
		return edge.Public{Zone: z, Owner: c.Owner(),
			Owns:      func(host string) bool { return naming.Owns(c, suffix, zone, host) },
			Addresses: func(ctx context.Context) ([]string, error) { return k.Addresses(ctx, node) }}
	default:
		log.Fatalf("HZ_EDGE %q: neither cloudflared nor proxy", e)
		return nil
	}
}
