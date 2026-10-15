// What a cluster install drives: a cloud, an edge, a shell on the control node. Steps use these and nothing else.
package infra

import (
	"context"
	"fmt"
	"io"
	"slices"
	"time"

	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/edge"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/naming"
)

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
	// A worker server with no actor this long is deleted.
	WorkerIdle time.Duration
	// An idle actor is paused after Pause and suspended after Suspend.
	Actors sandbox.Rest
	Tiers  []sandbox.Tier
	Zone   string
	// Previews are <name>-<cluster><PreviewSuffix>.<Zone>.
	PreviewSuffix string
	// The nodes' GOARCH, which ko builds for.
	Arch       string
	PublicKey  string
	PrivateKey []byte
}

// The operator's own files the install reads and writes: the sealing key, kept certificates, where the plane is.
type Laptop interface {
	// Nil, without an error, when there is no key.
	Key() ([]byte, error)
	SaveKey(key []byte) error
	KeyPath() string
	// Those kept for zone, opened with the key; nil, without an error, when none were kept.
	Certs(zone string) (map[string][]byte, error)
	SaveCerts(zone string, key []byte, data map[string][]byte) error
	CertsPath(zone string) string
	SavePlane(url, token string) error
}

type Env struct {
	Cluster naming.Cluster
	Config  Config
	// Nil on a cluster with no cloud, such as kind on this machine.
	Cloud cloud.Cloud
	// The cloud's credentials by its own keys, which the plane makes workers with.
	CloudCreds map[string]string
	Edge       edge.Edge
	// Dials the control node; set by the step that creates it.
	Dial    func(ctx context.Context, addr string) (Shell, error)
	Shell   Shell
	Control cloud.Server
	Laptop  Laptop
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
