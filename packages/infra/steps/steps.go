// The install, in order. Each step converges: it looks at what is there and makes the rest.
package steps

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/kube"
	"github.com/getnvoi/host0/infra/manifests"
	"github.com/getnvoi/host0/infra/node"
	"github.com/getnvoi/host0/infra/source"
	"github.com/getnvoi/host0/shared/naming"
	"github.com/getnvoi/host0/shared/state"
	"github.com/getnvoi/host0/shared/tiers"
)

type pool struct {
	tiers.Tier
	Name, Namespace string
	Replicas        int
}

func pools(e *infra.Env) []pool {
	var ps []pool
	for _, t := range tiers.All {
		ps = append(ps, pool{Tier: t, Name: t.Pool(), Namespace: "hz"})
	}
	return ps
}

const apiPort = "16443"

var Install = []infra.Step{
	step("network, firewall, ssh key", func(ctx context.Context, e *infra.Env) error {
		return e.Cloud.Base(ctx, e.Cluster, e.Config.Location, e.Config.PublicKey)
	}),
	always("control node", func(ctx context.Context, e *infra.Env) (err error) {
		if e.Control, err = e.Cloud.Server(ctx, e.Cluster, e.Cluster.Control(), e.Config.ControlType, e.Config.Location, naming.ControlIP); err != nil {
			return err
		}
		e.Say("%s at %s", e.Control.Name, e.Control.PublicIP)
		e.Shell, err = e.Dial(ctx, e.Control.PublicIP+":22")
		return err
	}),
	step("k3s", func(ctx context.Context, e *infra.Env) error {
		if err := e.Shell.Run(ctx, "cloud-init status --wait >/dev/null; sh -s", strings.NewReader(node.Server()), e.Out); err != nil {
			return err
		}
		// `wait` on no nodes fails at once: first wait for the node to register at all.
		if err := e.Shell.Run(ctx, "for i in $(seq 100); do [ -n \"$(k3s kubectl get nodes -o name 2>/dev/null)\" ] && exit 0; sleep 3; done; exit 1", nil, e.Out); err != nil {
			return err
		}
		if err := kube.Run(ctx, e.Shell, "wait --for=condition=Ready node --all --timeout=300s", e.Out); err != nil {
			return err
		}
		token, err := output(ctx, e, "cat /var/lib/rancher/k3s/server/node-token")
		e.Vars["token"] = token
		return err
	}),
	step("cloud controller and autoscaler", func(ctx context.Context, e *infra.Env) error {
		if err := apply(ctx, e, "namespace.yaml", nil); err != nil {
			return err
		}
		labels := node.Labels(source.Substrate.Version())
		addons, err := e.Cloud.Addons(e.Cluster, e.Config, node.Worker(e.Vars["token"], labels), labels)
		if err != nil {
			return err
		}
		if err := kube.Apply(ctx, e.Shell, addons, e.Out); err != nil {
			return err
		}
		return kube.Run(ctx, e.Shell, "wait --for=jsonpath={.spec.providerID} node --all --timeout=300s", e.Out)
	}),
	step("registry", func(ctx context.Context, e *infra.Env) error {
		if err := apply(ctx, e, "registry.yaml", map[string]string{"Registry": naming.Registry}); err != nil {
			return err
		}
		return kube.Rollout(ctx, e.Shell, naming.Namespace, "deployment", "registry", e.Out)
	}),
	always("tunnels to the apiserver and the registry", func(ctx context.Context, e *infra.Env) error {
		raw, err := output(ctx, e, "cat /etc/rancher/k3s/k3s.yaml")
		if err != nil {
			return err
		}
		dir, err := os.MkdirTemp("", "hz-")
		if err != nil {
			return err
		}
		e.Defer(func() { os.RemoveAll(dir) })
		e.Vars["kubeconfig"] = filepath.Join(dir, "kubeconfig")
		raw = strings.Replace(raw, "127.0.0.1:6443", "127.0.0.1:"+apiPort, 1)
		if err := os.WriteFile(e.Vars["kubeconfig"], []byte(raw), 0o600); err != nil {
			return err
		}
		for local, remote := range map[string]string{
			"127.0.0.1:" + apiPort:                           "127.0.0.1:6443",
			fmt.Sprintf("127.0.0.1:%d", naming.RegistryPort): naming.Registry,
		} {
			stop, err := e.Shell.Forward(ctx, local, remote)
			if err != nil {
				return err
			}
			e.Defer(stop)
		}
		return nil
	}),
	step("substrate", func(ctx context.Context, e *infra.Env) error {
		dir, err := substrate(ctx, e)
		if err != nil {
			return err
		}
		return source.CmdEnv(ctx, dir, ko(e), nil, e.Out, "go", "run", "./cmd/ate-setup",
			"--kind", "--kubeconfig", e.Vars["kubeconfig"], "--context", kubeContext(e),
			"--rollout-timeout", "600s", "deploy", "ate-system")
	}),
	step("worker pools", func(ctx context.Context, e *infra.Env) error {
		// replicas is the plane's: a pool is written back with what it has now, and a new one starts at zero.
		current, err := output(ctx, e, `k3s kubectl -n hz get workerpool -o jsonpath='{range .items[*]}{.metadata.name}={.spec.replicas}{"\n"}{end}'`)
		if err != nil {
			return err
		}
		ps := pools(e)
		for i := range ps {
			for _, line := range strings.Split(current, "\n") {
				if name, n, ok := strings.Cut(line, "="); ok && name == ps[i].Name {
					ps[i].Replicas, _ = strconv.Atoi(n)
				}
			}
		}
		rendered, err := manifests.Render("workerpools.yaml", map[string]any{"Pools": ps})
		if err != nil {
			return err
		}
		dir, err := substrate(ctx, e)
		if err != nil {
			return err
		}
		resolved, err := resolve(ctx, e, dir, rendered, "-f", "-")
		if err != nil {
			return err
		}
		if err := kube.Apply(ctx, e.Shell, resolved, e.Out); err != nil {
			return err
		}
		// Pools no tier declares any more.
		var names []string
		for _, p := range pools(e) {
			names = append(names, p.Name)
		}
		return kube.Run(ctx, e.Shell, "-n hz delete workerpool --ignore-not-found -l 'workload,workload notin ("+strings.Join(names, ",")+")'", e.Out)
	}),
	step("cloudflare tunnel", func(ctx context.Context, e *infra.Env) error {
		token, err := e.Edge.Tunnel(ctx, e.Cluster, "http://plane."+naming.Namespace+".svc:80")
		if err != nil {
			return err
		}
		if err := kube.Apply(ctx, e.Shell, kube.Secret(naming.Namespace, "cloudflared", map[string]string{"token": token})+"---\n"+
			kube.Secret(naming.Namespace, "cloudflare", map[string]string{"token": e.Config.CFToken, "zone": e.Config.Zone}), e.Out); err != nil {
			return err
		}
		if err := apply(ctx, e, "cloudflared.yaml", nil); err != nil {
			return err
		}
		return kube.Rollout(ctx, e.Shell, naming.Namespace, "deployment", "cloudflared", e.Out)
	}),
	step("control plane", func(ctx context.Context, e *infra.Env) error {
		// The box token is in every template: a new one would orphan every seed and fork. Only the API token rotates.
		token, box := secret(), ""
		if raw, err := output(ctx, e, "k3s kubectl -n "+naming.Namespace+" get secret plane -o jsonpath='{.data.box-token}' 2>/dev/null | base64 -d"); err == nil {
			box = raw
		}
		if box == "" {
			box = secret()
		}
		sum := sha256.Sum256([]byte(token))
		if err := kube.Apply(ctx, e.Shell, kube.Secret(naming.Namespace, "plane", map[string]string{
			"token-sha256": hex.EncodeToString(sum[:]), "box-token": box}), e.Out); err != nil {
			return err
		}
		m, err := manifests.Render("plane.yaml", map[string]string{"Cluster": e.Cluster.Name, "Zone": e.Config.Zone,
			"Suffix": e.Config.PreviewSuffix, "ControlLabel": controlLabel(e),
			"Secret": hex.EncodeToString(sum[:8])})
		if err != nil {
			return err
		}
		// The web UI is embedded in the plane binary, so it is built before ko builds the plane.
		ui := filepath.Join(e.Source, "packages", "ui")
		if err := source.Cmd(ctx, ui, nil, e.Out, "bun", "install", "--frozen-lockfile"); err != nil {
			return err
		}
		if err := source.Cmd(ctx, ui, nil, e.Out, "bun", "run", "build"); err != nil {
			return err
		}
		resolved, err := resolve(ctx, e, e.Source, m, "-f", "-")
		if err != nil {
			return err
		}
		if err := kube.Apply(ctx, e.Shell, resolved, e.Out); err != nil {
			return err
		}
		if err := kube.Rollout(ctx, e.Shell, naming.Namespace, "deployment", "plane", e.Out); err != nil {
			return err
		}
		url := origin(e, naming.Host(e.Cluster, "api", e.Config.Zone))
		if err := reachable(ctx, url, e.Out); err != nil {
			return err
		}
		e.Say("api at %s", url)
		e.Say("web UI at %s: sign in with hz open", origin(e, naming.Host(e.Cluster, "app", e.Config.Zone)))
		return state.Save(state.State{URL: url, Token: token})
	}),
}

func secret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// A step that runs under --only too: later steps need what it sets.
func always(name string, run func(context.Context, *infra.Env) error) infra.Step {
	return infra.Step{Name: name, Run: run, Always: true}
}

func step(name string, run func(context.Context, *infra.Env) error) infra.Step {
	return infra.Step{Name: name, Run: run}
}

func apply(ctx context.Context, e *infra.Env, name string, data any) error {
	m, err := manifests.Render(name, data)
	if err != nil {
		return err
	}
	return kube.Apply(ctx, e.Shell, m, e.Out)
}

func output(ctx context.Context, e *infra.Env, cmd string) (string, error) {
	var b strings.Builder
	err := e.Shell.Run(ctx, cmd, nil, &b)
	return strings.TrimSpace(b.String()), err
}

// ko builds for the nodes and pushes through the registry tunnel: amd64 on Hetzner, this machine's on a local one.
func ko(e *infra.Env) []string {
	platform := e.Vars["platform"]
	if platform == "" {
		platform = "linux/amd64"
	}
	return []string{"KO_DOCKER_REPO=" + naming.LocalRegistry(), "KO_DEFAULTPLATFORMS=" + platform,
		"KUBECONFIG=" + e.Vars["kubeconfig"], "NO_DEV_ENV=true"}
}

func resolve(ctx context.Context, e *infra.Env, dir string, stdin string, args ...string) (string, error) {
	var in io.Reader
	if stdin != "" {
		in = strings.NewReader(stdin)
	}
	return source.Capture(ctx, dir, ko(e), in, e.Out, "ko", append([]string{"resolve"}, args...)...)
}

func origin(_ *infra.Env, host string) string { return "https://" + host }

// The value k3s gives node-role.kubernetes.io/control-plane; kind's is empty.
func controlLabel(e *infra.Env) string {
	if l, ok := e.Vars["control-label"]; ok {
		return l
	}
	return "true"
}

func substrate(ctx context.Context, e *infra.Env) (string, error) {
	if e.Vars["local"] != "" {
		return source.SubstrateLocal.Dir(ctx, e.Cache, e.Out)
	}
	return source.Substrate.Dir(ctx, e.Cache, e.Out)
}

func kubeContext(e *infra.Env) string {
	if c := e.Vars["context"]; c != "" {
		return c
	}
	return "default"
}

// Waits until the plane answers through the tunnel several times in a row: new records reach Cloudflare's edge servers
// one by one, and one that has not yet answers with an error of its own (1000, a 403 page).
func reachable(ctx context.Context, url string, out io.Writer) error {
	client := &http.Client{Timeout: 10 * time.Second}
	deadline := time.Now().Add(5 * time.Minute)
	for streak := 0; streak < 5; {
		if time.Now().After(deadline) {
			return fmt.Errorf("%s does not answer through the tunnel", url)
		}
		res, err := client.Get(url + "/approvals")
		// The plane refuses a request without its token; anything else is not the plane.
		if err == nil && res.StatusCode == http.StatusUnauthorized && strings.HasPrefix(res.Header.Get("Content-Type"), "text/plain") {
			streak++
		} else {
			streak = 0
		}
		if res != nil {
			res.Body.Close()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	fmt.Fprintf(out, "  %s answers through the tunnel\n", url)
	return nil
}
