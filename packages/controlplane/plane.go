// The control plane: environments, their seed, sessions forked from it, and the approvals between a turn and
// what it asked for. What it drives is behind these interfaces; the implementations are subpackages.
package controlplane

import (
	"context"
	"errors"
	"net"

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

type Container struct {
	Name, Image string
	Command     []string
	Env         map[string]string
	Probe       int // port answering GET /health, the actor's wake signal
}

type Sandboxes interface {
	// The template for these containers; the name is derived from their content, so an unchanged environment reuses it.
	Template(ctx context.Context, env string, tier tiers.Tier, cs []Container) (string, error)
	// Created, not running. A tag seeds it from a suspended actor's snapshot.
	Create(ctx context.Context, name, template, tag string) error
	// Running when it returns nil; ErrNoWorker when its pool has no free worker.
	Resume(ctx context.Context, name string) error
	// Stopped with its snapshot kept on the node: resumes fast, on that node only.
	Pause(ctx context.Context, name string) error
	// running, paused, suspended, or the state in transit.
	State(ctx context.Context, name string) (string, error)
	// The node a running actor is on; a pause leaves its snapshot there.
	Node(ctx context.Context, name string) (string, error)
	Workers(ctx context.Context) ([]Worker, error)
	Suspend(ctx context.Context, name string) error
	Tag(ctx context.Context, tag, actor string) error
	Delete(ctx context.Context, name string) error
	// A connection to a port inside the actor; wakes a suspended one.
	Dial(ctx context.Context, actor string, port int) (net.Conn, error)
}

type Store interface {
	Get(kind, id string, v any) error
	Put(kind, id string, v any) error
	Delete(kind, id string) error
	List(kind string, each func(decode func(any) error) error) error
}

type Edge interface {
	// A proxied record for host, pointing at the cluster's tunnel.
	Route(ctx context.Context, host string) error
}

type Forge interface {
	PullRequest(ctx context.Context, token, repo, head, base, title, body string) (string, error)
}

var ErrNotFound = contract.ErrNotFound

var ErrNoWorker = errors.New("no free worker")
