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

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/cloud/clouds"
	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/edge"
	"github.com/getnvoi/host0/internal/edge/cloudflare"
	"github.com/getnvoi/host0/internal/edge/dns"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/llm/claude"
	"github.com/getnvoi/host0/internal/llm/codex"
	"github.com/getnvoi/host0/internal/preview"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/sandbox/substrate"
	"github.com/getnvoi/host0/internal/scm"
	"github.com/getnvoi/host0/internal/scm/github"
	"github.com/getnvoi/host0/internal/shared/naming"
	"github.com/getnvoi/host0/internal/stream"
	"github.com/getnvoi/host0/internal/tools"
	"github.com/getnvoi/host0/internal/workers"
	"github.com/getnvoi/host0/internal/workspace"
)

var _ workers.Pools = (*kube.Client)(nil)

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
	if len(os.Args) > 1 && os.Args[1] == "openapi" {
		if err := writeSpec(os.Args[2:]); err != nil {
			log.Fatalf("openapi: %v", err)
		}
		return
	}
	sb, err := substrate.New(substrate.Config{
		API:       "api.ate-system.svc.cluster.local:443",
		Authority: "api.ate-system.svc",
		CAFile:    "/run/servicedns-ca/trust-bundle.pem",
		TokenFile: "/var/run/secrets/ateapi/token",
		Router:    "atenet-router.ate-system.svc.cluster.local:8081",
		Atespace:  "hz",
		// The bucket in the cluster's own S3 store (rustfs in ate-system); substrate names every bucket gs://.
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
	gdb, err := db.Open("/var/lib/hz/hz.db", key)
	if err != nil {
		log.Fatal(err)
	}
	if err := db.Migrate(gdb); err != nil {
		log.Fatal(err)
	}
	cluster, zone := must("HZ_CLUSTER"), must("HZ_ZONE")
	cl, init, err := workerCloud("/etc/hz/cloud")
	if err != nil {
		log.Fatalf("cloud: %v", err)
	}
	p := wire(gdb, sb, pools, selectEdge(pools, cluster, zone), cluster, zone, must("HZ_PREVIEW_SUFFIX"), must("HZ_BOX_TOKEN"))
	p.Pods = pools
	p.sc.Cloud, p.sc.WorkerInit = cl, init
	p.sc.PauseAfter, p.sc.SuspendAfter = duration("HZ_PAUSE_AFTER", 10*time.Minute), duration("HZ_SUSPEND_AFTER", 60*time.Minute)
	p.ws.Pin, p.ws.BoxImage = substrate.PinDockerHub, must("HZ_BOXD_IMAGE")
	api, app := p.Host("api"), p.Host("app")
	for _, h := range []string{api, app} {
		go route(p.Edge, h)
	}
	p.ws.Recover()
	go p.ws.Stale()
	go p.sc.Scale(context.Background())
	go p.Sample(context.Background())
	log.Printf("plane on :8080, api at https://%s, app at https://%s", api, app)
	srv := &http.Server{Addr: ":8080", Handler: p.Handler(api, app, must("HZ_TOKEN_SHA256")),
		ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	log.Fatal(srv.ListenAndServe())
}

// Writes the API's spec to the file named, or to stdout.
func writeSpec(args []string) error {
	b, err := spec()
	if err != nil {
		return err
	}
	if len(args) == 0 {
		_, err = os.Stdout.Write(b)
		return err
	}
	return os.WriteFile(args[0], b, 0o644)
}

// The plane: one workspace and the scaler under it, sign-in, the preview gate and the stream.
type plane struct {
	DB        *gorm.DB
	Sandboxes sandbox.Sandboxes
	Pools     workers.Pools
	// Reads any pod and its log, for hz pods and hz logs.
	Pods    Pods
	Edge    edge.Router
	Cluster string
	Zone    string
	// How often usage is sampled; a minute when zero.
	UsageEvery time.Duration

	ws   *workspace.Workspace
	sc   *workers.Scaler
	auth *auth.Auth
	gate preview.Gate
	bus  *stream.Broker
	// The web UI's host, which a sign-in link opens.
	app string
	// The routes served outside Huma, as "<mux> <pattern>".
	raw []string
}

type Pods interface {
	List(ctx context.Context, node string) ([]kube.Pod, error)
	Log(ctx context.Context, namespace, pod, container string, tail int) (string, error)
}

// The agent CLIs a credential may name.
var runners = []llm.Runner{claude.Runner{}, codex.Runner{}}

// Each part on the database and the sandboxes, and each told of the others.
func wire(gdb *gorm.DB, sb sandbox.Sandboxes, pools workers.Pools, e edge.Router, cluster, zone, suffix, boxToken string) *plane {
	bus := stream.New(workspace.Update{Kind: "reset"})
	sc := &workers.Scaler{Sandboxes: sb, Pools: pools, DB: gdb, Cluster: cluster}
	ws := &workspace.Workspace{Sandboxes: sb, DB: gdb, Edge: e, Workers: sc, Tools: toolbox{github.Forge{}}, Bus: bus,
		Runners: runners, BoxToken: boxToken, Cluster: cluster, Zone: zone, Suffix: suffix}
	sc.Named, sc.Woken = ws.Named, ws.Unkeyed
	return &plane{DB: gdb, Sandboxes: sb, Pools: pools, Edge: e, Cluster: cluster, Zone: zone,
		ws: ws, sc: sc, auth: &auth.Auth{DB: gdb}, gate: preview.Gate{Secret: boxToken}, bus: bus}
}

// One label under the zone, which its universal certificate covers: api-dev.nvoi.to.
func (p *plane) Host(name string) string {
	return naming.Host(naming.Cluster{Name: p.Cluster}, name, p.Zone)
}

// The tools package, as the workspace asks for it.
type toolbox struct{ forge scm.Forge }

func (toolbox) Spec() []map[string]any    { return tools.Spec() }
func (toolbox) Policy(name string) string { return tools.Policy(name) }

func (t toolbox) Do(ctx context.Context, w *workspace.Target, name, input string) string {
	c := &tools.Call{Box: w.Box, Forge: t.forge, Token: w.Token, Dir: w.Dir, Repo: w.Repo, Base: w.Base, Branch: w.Branch,
		Title: w.Title, Started: w.Started}
	out := tools.Do(ctx, c, name, input)
	w.Title = c.Title
	return out
}

// The cloud the plane makes worker servers on, from the Secret install mounts at dir; none on a cluster without one.
func workerCloud(dir string) (func(location string) (cloud.Cloud, error), string, error) {
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
func route(e edge.Router, host string) {
	for wait := 5 * time.Second; ; wait = min(2*wait, 5*time.Minute) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		err := e.Route(ctx, host)
		cancel()
		if err == nil {
			return
		}
		log.Printf("route %s: %v; again in %s", host, err, wait)
		time.Sleep(wait)
	}
}

// The edge the install deployed beside the plane, named by its Deployment.
func selectEdge(k *kube.Client, cluster, zone string) edge.Router {
	switch e := must("HZ_EDGE"); e {
	case "cloudflared":
		return cloudflare.Router{Token: must("CLOUDFLARE_API_TOKEN"), Zone: zone, TunnelToken: must("TUNNEL_TOKEN")}
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
		return dns.Public{Zone: z, Owner: c.Owner(),
			Owns:      func(host string) bool { return naming.Owns(c, suffix, zone, host) },
			Addresses: func(ctx context.Context) ([]string, error) { return k.Addresses(ctx, node) }}
	default:
		log.Fatalf("HZ_EDGE %q: neither cloudflared nor proxy", e)
		return nil
	}
}
