// What a cluster install drives: a cloud, an edge, a shell on the control node. Steps use these and nothing else.
package infra

import (
	"context"
	"fmt"
	"io"
	"slices"

	"github.com/getnvoi/host0/shared/naming"
)

type Server struct {
	ID         int64
	Name       string
	PublicIP   string
	PublicIPv6 string // empty when the server has none
}

type Cloud interface {
	// Network, firewall and ssh key, each named Cluster.Prefix(); the autoscaler finds them by that name. The firewall
	// lets in tcp 22 and open, and nothing else.
	Base(ctx context.Context, c naming.Cluster, location, publicKey string, open []int) error
	// The server by name as it is now; an error when there is none.
	Lookup(ctx context.Context, name string) (Server, error)
	Server(ctx context.Context, c naming.Cluster, name, serverType, location, privateIP string) (Server, error)
	// This cloud's controller and autoscaler, and their secret; workers boot with workerInit and carry labels.
	Addons(c naming.Cluster, cfg Config, workerInit string, labels map[string]string) (string, error)
	// Location and server types, when the flags leave them empty.
	Defaults() Config
	Destroy(ctx context.Context, c naming.Cluster) error
}

// Every worker carries the taint; only sandbox workers and atelet land there.
const WorkerTaint = "ate.dev/sandboxClass"

// Where the cluster's hosts reach it: Cloudflare's tunnel, or records at the control node and a proxy there.
type Edge interface {
	// tcp ports the control node opens to the world, beyond ssh.
	Ports() []int
	// Points hosts at the cluster, every request going to service; returns the Secrets, by name, its Deployment reads.
	Serve(ctx context.Context, c naming.Cluster, service string, hosts []string) (map[string]map[string]string, error)
	// The Deployment that runs it in naming.Namespace, from manifests/<Deployment>.yaml.
	Deployment() string
	// Reads the zone with the given credentials; install runs it before anything is created.
	Reach(ctx context.Context) error
	// The cluster's records in the zone now, one line each: name, type, value.
	Records(ctx context.Context, c naming.Cluster) ([]string, error)
	Destroy(ctx context.Context, c naming.Cluster) error
}

type Shell interface {
	Run(ctx context.Context, cmd string, stdin io.Reader, out io.Writer) error
	// Listens on local and dials remote from the control node.
	Forward(ctx context.Context, local, remote string) (func(), error)
}

type Config struct {
	Location    string
	ControlType string
	WorkerType  string
	WorkerMax   int
	Zone        string
	// Previews are <name>-<cluster><PreviewSuffix>.<Zone>.
	PreviewSuffix string
	HcloudToken   string
	PublicKey     string
	PrivateKey    []byte
}

type Env struct {
	Cluster naming.Cluster
	Config  Config
	Cloud   Cloud
	Edge    Edge
	// Dials the control node; set by the step that creates it.
	Dial    func(ctx context.Context, addr string) (Shell, error)
	Shell   Shell
	Control Server
	Out     io.Writer
	Cache   string
	// The repository root, where ko builds the plane and boxd.
	Source string
	// Values one step hands to a later one.
	Vars    map[string]string
	cleanup []func()
}

func (e *Env) Say(format string, a ...any) { fmt.Fprintf(e.Out, "  "+format+"\n", a...) }

func (e *Env) Defer(f func()) { e.cleanup = append(e.cleanup, f) }

func (e *Env) Close() {
	for i := len(e.cleanup) - 1; i >= 0; i-- {
		e.cleanup[i]()
	}
	e.cleanup = nil
}

// only, when set, names the steps to run; the rest are skipped. Steps that set Env fields for later ones run anyway.
func Run(ctx context.Context, e *Env, steps []Step, only ...string) error {
	defer e.Close()
	for i, s := range steps {
		if len(only) > 0 && !s.Always && !slices.Contains(only, s.Name) {
			continue
		}
		fmt.Fprintf(e.Out, "[%d/%d] %s\n", i+1, len(steps), s.Name)
		if err := s.Run(ctx, e); err != nil {
			return fmt.Errorf("%s: %w", s.Name, err)
		}
	}
	return nil
}

type Step struct {
	Name   string
	Run    func(ctx context.Context, e *Env) error
	Always bool
}
