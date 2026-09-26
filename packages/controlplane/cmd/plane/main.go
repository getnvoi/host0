// The plane, in the cluster. Everything it is told comes from its environment, which the install writes.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/getnvoi/nvoi/controlplane"
	"github.com/getnvoi/nvoi/controlplane/edge"
	"github.com/getnvoi/nvoi/controlplane/forge"
	"github.com/getnvoi/nvoi/controlplane/kube"
	"github.com/getnvoi/nvoi/controlplane/store"
	"github.com/getnvoi/nvoi/controlplane/substrate"
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
		Atespace:  "nvoi",
		Snapshots: "gs://ate-snapshots/nvoi/",
	})
	if err != nil {
		log.Fatalf("substrate: %v", err)
	}
	pools, err := kube.InCluster("nvoi")
	if err != nil {
		log.Fatalf("kube: %v", err)
	}
	cluster, zone := must("NVOI_CLUSTER"), must("NVOI_ZONE")
	p := &controlplane.Plane{
		Sandboxes:    sb,
		Pools:        pools,
		Store:        &store.Files{Root: "/var/lib/nvoi"},
		Edge:         edge.Cloudflare{Token: must("CLOUDFLARE_API_TOKEN"), Zone: zone, TunnelToken: must("TUNNEL_TOKEN")},
		Forge:        forge.GitHub{},
		Pin:          controlplane.PinDockerHub,
		BoxImage:     must("NVOI_BOXD_IMAGE"),
		BoxToken:     must("NVOI_BOX_TOKEN"),
		Cluster:      cluster,
		Zone:         zone,
		Suffix:       must("NVOI_PREVIEW_SUFFIX"),
		PauseAfter:   duration("NVOI_PAUSE_AFTER", 10*time.Minute),
		SuspendAfter: duration("NVOI_SUSPEND_AFTER", 60*time.Minute),
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
	srv := &http.Server{Addr: ":8080", Handler: p.Handler(api, app, must("NVOI_TOKEN_SHA256")),
		ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	log.Fatal(srv.ListenAndServe())
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
