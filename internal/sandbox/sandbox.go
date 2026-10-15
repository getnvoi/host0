// What runs a sandbox: one actor per environment seed or session, its containers, the workers it is placed on.
package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net"
)

type Container struct {
	Name, Image string
	Command     []string
	Env         map[string]string
	Probe       int // port answering GET /health, the actor's wake signal
}

type Sandboxes interface {
	// The template for these containers; the name is derived from their content, so an unchanged environment reuses it.
	Template(ctx context.Context, env string, tier Tier, cs []Container) (string, error)
	// Created, not running. A tag seeds it from a suspended actor's snapshot.
	Create(ctx context.Context, name, template, tag string) error
	// Running when it returns nil; ErrNoWorker when its pool has no free worker.
	Resume(ctx context.Context, name string) error
	// Stopped with its snapshot kept on the node: resumes fast, on that node only.
	Pause(ctx context.Context, name string) error
	// running, paused, suspended, or the state in transit.
	State(ctx context.Context, name string) (string, error)
	// The node a running actor is on; a pause leaves its snapshot there. Empty when no worker holds it.
	Node(ctx context.Context, name string) (string, error)
	Workers(ctx context.Context) ([]Worker, error)
	Suspend(ctx context.Context, name string) error
	Tag(ctx context.Context, tag, actor string) error
	Delete(ctx context.Context, name string) error
	// A connection to a port inside the actor; wakes a suspended one.
	Dial(ctx context.Context, actor string, port int) (net.Conn, error)
}

var ErrNotFound = errors.New("not found")

var ErrNoWorker = errors.New("no free worker")

type Worker struct {
	Pool, Pod string
	Held      []Held
}

// An actor Substrate has assigned to a worker, with its state asked at the same time.
type Held struct {
	// Space is empty for the plane's own atespace; a template's golden actor is in Substrate's.
	Space, Name string
	// Empty when Substrate has no such actor: the assignment is stale and holds nothing.
	State string
}

func (h Held) String() string {
	name := h.Name
	if h.Space != "" {
		name = h.Space + "/" + name
	}
	if h.State == "" {
		return name + " (not found)"
	}
	return name + " " + h.State
}

// Held by an actor Substrate knows.
func (w Worker) Assigned() bool {
	for _, h := range w.Held {
		if h.State != "" {
			return true
		}
	}
	return false
}

// A preview host's way in: the actor, the port its app answers on, the tier it wakes at. A row of routes holds it.
type Route struct {
	Actor string `json:"actor"`
	Port  int    `json:"port"`
	Tier  string `json:"tier"`
}

type progressKey struct{}

// ctx whose waits on a sandbox report each step to f: the seed or session waiting on a worker shows it.
func WithProgress(ctx context.Context, f func(string)) context.Context {
	return context.WithValue(ctx, progressKey{}, f)
}

// Sends the line to the ctx's WithProgress, if it has one.
func Progress(ctx context.Context, format string, a ...any) {
	if f, ok := ctx.Value(progressKey{}).(func(string)); ok {
		f(fmt.Sprintf(format, a...))
	}
}
