package steps

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/infra/source"
	"github.com/getnvoi/host0/shared/naming"
)

// The kind cluster's name; its kubectl context is kind-<name>, its node <name>-control-plane.
const LocalCluster = "hz"

// The install on this machine: the cluster install's steps, on a kind cluster in Docker (OrbStack's, Docker Desktop's)
// instead of Hetzner servers. The plane, its tunnel and its hosts are the same as on a cloud cluster.
var Local = []infra.Step{
	always("kind cluster", func(ctx context.Context, e *infra.Env) error {
		dir, err := source.SubstrateLocal.Dir(ctx, e.Cache, e.Out)
		if err != nil {
			return err
		}
		kind := filepath.Join(dir, "hack", "kind.sh")
		env := []string{"KIND_CLUSTER_NAME=" + LocalCluster, fmt.Sprintf("KIND_REGISTRY_PORT=%d", naming.RegistryPort)}
		have, err := source.Capture(ctx, dir, env, nil, e.Out, kind, "get", "clusters")
		if err != nil {
			return err
		}
		// Substrate's script starts over from nothing, so it runs only when the cluster is not there.
		if !contains(have, LocalCluster) {
			if err := source.CmdEnv(ctx, dir, env, nil, e.Out, filepath.Join(dir, "hack", "create-kind-cluster.sh")); err != nil {
				return err
			}
		}
		tmp, err := os.MkdirTemp("", "hz-")
		if err != nil {
			return err
		}
		e.Defer(func() { os.RemoveAll(tmp) })
		e.Vars["kubeconfig"] = filepath.Join(tmp, "kubeconfig")
		e.Vars["context"] = "kind-" + LocalCluster
		if err := source.CmdEnv(ctx, dir, env, nil, e.Out, kind, "export", "kubeconfig", "--name", LocalCluster, "--kubeconfig", e.Vars["kubeconfig"]); err != nil {
			return err
		}
		e.Shell = local{context: e.Vars["context"]}
		e.Vars["control-label"] = ""
		// The one node takes the worker pools too.
		return e.Shell.Run(ctx, "k3s kubectl label node "+LocalCluster+"-control-plane hz.dev/worker=true --overwrite", nil, e.Out)
	}),
	step("namespaces", func(ctx context.Context, e *infra.Env) error {
		return apply(ctx, e, "namespace.yaml", nil)
	}),
	find("substrate"),
	find("worker pools"),
	find("cloudflare tunnel"),
	find("control plane"),
}

// Removes the kind cluster and its registry; the tunnel and its records go with Edge.Destroy, as a cloud cluster's.
func LocalDown(ctx context.Context, cache string, out io.Writer) error {
	dir, err := source.SubstrateLocal.Dir(ctx, cache, out)
	if err != nil {
		return err
	}
	env := []string{"KIND_CLUSTER_NAME=" + LocalCluster}
	if err := source.CmdEnv(ctx, dir, env, nil, out, filepath.Join(dir, "hack", "kind.sh"), "delete", "cluster", "--name", LocalCluster); err != nil {
		return err
	}
	exec.CommandContext(ctx, "docker", "rm", "-f", "kind-registry").Run()
	return nil
}

func find(name string) infra.Step {
	for _, s := range Install {
		if s.Name == name {
			return s
		}
	}
	panic("no install step " + name)
}

func contains(lines, want string) bool {
	for _, l := range strings.Split(lines, "\n") {
		if strings.TrimSpace(l) == want {
			return true
		}
	}
	return false
}

// kubectl on this machine, against the kind context: the install's commands say "k3s kubectl" for the node.
type local struct{ context string }

func (l local) Run(ctx context.Context, cmd string, stdin io.Reader, out io.Writer) error {
	cmd = strings.ReplaceAll(cmd, "k3s kubectl ", "kubectl --context "+l.context+" ")
	c := exec.CommandContext(ctx, "sh", "-c", cmd)
	c.Stdin, c.Stdout, c.Stderr = stdin, out, out
	return c.Run()
}

func (local) Forward(context.Context, string, string) (func(), error) { return func() {}, nil }
