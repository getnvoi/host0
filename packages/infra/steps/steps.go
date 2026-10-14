// The install, in order. Each step converges: it looks at what is there and makes the rest.
package steps

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/kube"
	"github.com/getnvoi/host0/infra/manifests"
	"github.com/getnvoi/host0/infra/node"
	"github.com/getnvoi/host0/infra/source"
	"github.com/getnvoi/host0/shared/naming"
	"github.com/getnvoi/host0/shared/seal"
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
	step("dns credentials", func(ctx context.Context, e *infra.Env) error { return e.Edge.Reach(ctx) }),
	step("base", func(ctx context.Context, e *infra.Env) error {
		return e.Cloud.Base(ctx, e.Cluster, e.Config.Location, e.Config.PublicKey, e.Edge.Ports())
	}),
	always("control node", func(ctx context.Context, e *infra.Env) (err error) {
		spec := cloud.Spec{Name: e.Cluster.Control(), Type: e.Config.ControlType, Location: e.Config.Location, PrivateIP: naming.ControlIP}
		if e.Control, err = e.Cloud.Server(ctx, e.Cluster, spec); err != nil {
			return err
		}
		e.Say("%s at %s", e.Control.Name, strings.Join(addresses(e.Control), ", "))
		e.Shell, err = e.Dial(ctx, e.Control.PublicIP+":22")
		return err
	}),
	step("k3s", func(ctx context.Context, e *infra.Env) error {
		id := e.Cloud.ProviderID(e.Control)
		script := node.Server(id, strings.Join(addresses(e.Control), ","))
		if err := e.Shell.Run(ctx, "cloud-init status --wait >/dev/null; sh -s", strings.NewReader(script), e.Out); err != nil {
			return err
		}
		// `wait` on no nodes fails at once: first wait for the node to register at all.
		if err := e.Shell.Run(ctx, "for i in $(seq 100); do [ -n \"$(k3s kubectl get nodes -o name 2>/dev/null)\" ] && exit 0; sleep 3; done; exit 1", nil, e.Out); err != nil {
			return err
		}
		if err := kube.Run(ctx, e.Shell, "wait --for=condition=Ready node --all --timeout=300s", e.Out); err != nil {
			return err
		}
		// k3s's own cloud controller copies node-external-ip into the node's addresses.
		for _, ip := range addresses(e.Control) {
			if err := kube.Run(ctx, e.Shell, "wait --for=jsonpath='{.status.addresses[?(@.address==\""+ip+"\")].type}'=ExternalIP node "+
				"-l node-role.kubernetes.io/control-plane --timeout=120s", e.Out); err != nil {
				return err
			}
		}
		if got, err := kube.Output(ctx, e.Shell, "get node -l node-role.kubernetes.io/control-plane -o jsonpath={.items[0].spec.providerID}"); err != nil || got != id {
			return fmt.Errorf("the control node's providerID is %q, not %s: %v", got, id, err)
		}
		if err := e.Shell.Run(ctx, "sh -s", strings.NewReader(node.Encrypt), e.Out); err != nil {
			return err
		}
		token, err := output(ctx, e, "cat /var/lib/rancher/k3s/server/node-token")
		e.Vars["token"] = token
		return err
	}),
	step("autoscaler", func(ctx context.Context, e *infra.Env) error {
		if err := apply(ctx, e, "namespace.yaml", nil); err != nil {
			return err
		}
		scaler, ok := e.Cloud.(cloud.Autoscaler)
		if !ok {
			e.Say("%s has no autoscaler", e.Cloud.Name())
			return nil
		}
		labels := node.Labels(source.Substrate.Version())
		m, err := scaler.Autoscaler(e.Cluster, e.Config.WorkerMax, e.Config.WorkerType, e.Config.Location,
			node.Worker(e.Vars["token"], labels, e.Cloud.Identity()), labels)
		if err != nil {
			return err
		}
		return kube.Apply(ctx, e.Shell, m, e.Out)
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
	step("certificates", certificates),
	step("edge", func(ctx context.Context, e *infra.Env) error {
		secrets, err := e.Edge.Serve(ctx, e.Cluster, service, hosts(e))
		if err != nil {
			return err
		}
		var objs []string
		for _, name := range slices.Sorted(maps.Keys(secrets)) {
			objs = append(objs, cloud.Secret(naming.Namespace, name, secrets[name]))
		}
		if err := kube.Apply(ctx, e.Shell, strings.Join(objs, "---\n"), e.Out); err != nil {
			return err
		}
		m, err := manifests.Render(e.Edge.Deployment()+".yaml", map[string]string{"ControlLabel": controlLabel(e), "Service": service})
		if err != nil {
			return err
		}
		if strings.Contains(m, "ko://") {
			if m, err = resolve(ctx, e, e.Source, m, "-f", "-"); err != nil {
				return err
			}
		}
		if err := kube.Apply(ctx, e.Shell, m, e.Out); err != nil {
			return err
		}
		return kube.Rollout(ctx, e.Shell, naming.Namespace, "deployment", e.Edge.Deployment(), e.Out)
	}),
	step("control plane", func(ctx context.Context, e *infra.Env) error {
		// The box token is in every template: a new one would orphan every seed and fork. Only the API token rotates.
		have, err := secretData(ctx, e, "plane")
		if err != nil {
			return err
		}
		token, box := secret(), string(have["box-token"])
		if box == "" {
			box = secret()
		}
		local, err := state.Key()
		if err != nil {
			return err
		}
		key, err := sealKey(local, have["seal"])
		if err != nil {
			return err
		}
		if local == nil {
			if err := state.SaveKey(key); err != nil {
				return err
			}
			e.Say("sealing key at %s: back it up, the plane's records open with nothing else", state.KeyPath())
		}
		if have["seal"] == nil && local != nil {
			e.Say("sealing key restored to the cluster from %s", state.KeyPath())
		}
		sum := sha256.Sum256([]byte(token))
		if err := kube.Apply(ctx, e.Shell, cloud.Secret(naming.Namespace, "plane", map[string]string{
			"token-sha256": hex.EncodeToString(sum[:]), "box-token": box, "seal": string(key)}), e.Out); err != nil {
			return err
		}
		m, err := manifests.Render("plane.yaml", map[string]string{"Cluster": e.Cluster.Name, "Zone": e.Config.Zone,
			"Edge":   e.Edge.Deployment(),
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
			logs, lerr := output(ctx, e, "k3s kubectl -n "+naming.Namespace+" logs deploy/"+e.Edge.Deployment()+" --tail=15")
			if lerr != nil {
				logs = lerr.Error()
			}
			return fmt.Errorf("%w; %s says:\n%s", err, e.Edge.Deployment(), logs)
		}
		e.Say("api at %s", url)
		e.Say("web UI at %s: sign in with hz open", origin(e, naming.Host(e.Cluster, "app", e.Config.Zone)))
		return state.Save(state.State{URL: url, Token: token})
	}),
}

// Every request on the edge goes to the plane, which reads the host.
const service = "http://plane." + naming.Namespace + ".svc:80"

// The hosts the plane serves from boot; previews are routed by the plane as they come.
func hosts(e *infra.Env) []string {
	return []string{naming.Host(e.Cluster, "api", e.Config.Zone), naming.Host(e.Cluster, "app", e.Config.Zone)}
}

// A secret's values in naming.Namespace by key; none when there is no secret.
func secretData(ctx context.Context, e *infra.Env, name string) (map[string][]byte, error) {
	raw, err := kube.Output(ctx, e.Shell, "-n "+naming.Namespace+" get secret "+name+" --ignore-not-found -o jsonpath={.data}")
	if err != nil {
		return nil, fmt.Errorf("reading secret %s: %w: %s", name, err, raw)
	}
	data := map[string]string{}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &data); err != nil {
			return nil, fmt.Errorf("secret %s's data: %w: %s", name, err, raw)
		}
	}
	out := map[string][]byte{}
	for k, v := range data {
		b, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			return nil, fmt.Errorf("secret %s's %s: %w", name, k, err)
		}
		out[k] = b
	}
	return out, nil
}

// The edge that keeps its certificates in naming.Certs.
const proxy = "proxy"

// Creates naming.Certs for the proxy, empty, or from ~/.hz/certs/<zone> when that file exists. A cluster's own
// certificates are never replaced.
func certificates(ctx context.Context, e *infra.Env) error {
	if e.Edge.Deployment() != proxy {
		return nil
	}
	have, err := secretData(ctx, e, naming.Certs)
	if err != nil {
		return err
	}
	if len(have) > 0 {
		return nil
	}
	data := map[string]string{}
	path := state.CertsPath(e.Config.Zone)
	if _, err := os.Stat(path); err == nil {
		key, err := state.Key()
		if err != nil {
			return err
		}
		if key == nil {
			return fmt.Errorf("%s is sealed with %s, which is not there", path, state.KeyPath())
		}
		saved, err := state.Certs(e.Config.Zone, key)
		if err != nil {
			return err
		}
		for k, v := range saved {
			data[k] = string(v)
		}
		e.Say("certificates restored from %s", path)
	}
	return kube.Apply(ctx, e.Shell, cloud.Secret(naming.Namespace, naming.Certs, data), e.Out)
}

// Writes the proxy's certificate secret to ~/.hz/certs/<zone>, sealed with ~/.hz/key, for the next install of the
// zone to restore. Run before the servers go.
func KeepCerts(ctx context.Context, e *infra.Env) error {
	if e.Edge.Deployment() != proxy {
		return fmt.Errorf("--keep-cert keeps the public edge's certificate; this cluster's edge is %s", e.Edge.Deployment())
	}
	key, err := state.Key()
	if err != nil {
		return err
	}
	if key == nil {
		return fmt.Errorf("--keep-cert seals with %s, which is not there", state.KeyPath())
	}
	control, err := e.Cloud.Lookup(ctx, e.Cluster.Control())
	if err != nil {
		return err
	}
	if e.Shell, err = e.Dial(ctx, control.PublicIP+":22"); err != nil {
		return err
	}
	if c, ok := e.Shell.(io.Closer); ok {
		e.Defer(func() { c.Close() })
	}
	data, err := secretData(ctx, e, naming.Certs)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("secret %s holds no certificate to keep", naming.Certs)
	}
	if err := state.SaveCerts(e.Config.Zone, key, data); err != nil {
		return err
	}
	e.Say("certificates kept at %s", state.CertsPath(e.Config.Zone))
	return nil
}

// The sealing key, from ~/.hz/key and the cluster's: equal, or the one that exists restores the other, or a new one.
func sealKey(local, cluster []byte) ([]byte, error) {
	if cluster != nil && len(cluster) != seal.Size {
		return nil, fmt.Errorf("the plane secret's seal is %d bytes, not %d", len(cluster), seal.Size)
	}
	switch {
	case local == nil && cluster == nil:
		return seal.Mint(), nil
	case local == nil:
		return cluster, nil
	case cluster == nil:
		return local, nil
	case !bytes.Equal(local, cluster):
		return nil, fmt.Errorf("%s differs from the sealing key in the cluster's plane secret, which sealed the plane's records: "+
			"move %s aside and install again to restore it from the cluster", state.KeyPath(), state.KeyPath())
	}
	return local, nil
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

// ko builds for the nodes' arch and pushes through the registry tunnel.
func ko(e *infra.Env) []string {
	return []string{"KO_DOCKER_REPO=" + naming.LocalRegistry(), "KO_DEFAULTPLATFORMS=linux/" + e.Config.Arch,
		"KUBECONFIG=" + e.Vars["kubeconfig"], "NO_DEV_ENV=true"}
}

func resolve(ctx context.Context, e *infra.Env, dir string, stdin string, args ...string) (string, error) {
	var in io.Reader
	if stdin != "" {
		in = strings.NewReader(stdin)
	}
	return source.Capture(ctx, dir, ko(e), in, e.Out, "ko", append([]string{"resolve"}, args...)...)
}

// The server's public addresses, IPv4 first.
func addresses(s cloud.Server) []string {
	if s.PublicIPv6 == "" {
		return []string{s.PublicIP}
	}
	return []string{s.PublicIP, s.PublicIPv6}
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

// Waits until the plane answers through the edge several times in a row: new records reach Cloudflare's edge servers
// one by one, and one that has not yet answers with an error of its own (1000, a 403 page).
func reachable(ctx context.Context, url string, out io.Writer) error {
	client := &http.Client{Timeout: 10 * time.Second}
	deadline := time.Now().Add(5 * time.Minute)
	last := ""
	for streak := 0; streak < 5; {
		res, err := client.Get(url + "/approvals")
		got := ""
		switch {
		case err != nil:
			got = err.Error()
		// The plane refuses a request without its token; anything else is not the plane.
		case res.StatusCode == http.StatusUnauthorized && strings.HasPrefix(res.Header.Get("Content-Type"), "text/plain"):
			got = "plane"
		default:
			got = res.Status
		}
		if res != nil {
			res.Body.Close()
		}
		if got == "plane" {
			streak++
		} else {
			streak = 0
		}
		if got != last {
			fmt.Fprintf(out, "  %s: %s\n", url, got)
			last = got
		}
		if streak < 5 && time.Now().After(deadline) {
			return fmt.Errorf("%s does not answer through the edge in 5m; last: %s", url, last)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	fmt.Fprintf(out, "  %s answers through the edge\n", url)
	return nil
}
