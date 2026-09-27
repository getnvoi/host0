package controlplane

import (
	"context"
	"errors"
	"fmt"

	"github.com/getnvoi/host0/controlplane/box"
	"github.com/getnvoi/host0/shared/contract"
)

// Where each service's output is kept, beside its stdout.
const Logs = "/workspace/.hz/logs"

// The setup script's log, then one per service, in the environment's order.
func (p *Plane) Logs(sid string) ([]contract.Log, error) {
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return nil, err
	}
	env, _, err := p.env(s.Env)
	if err != nil {
		return nil, err
	}
	out := []contract.Log{{Name: "setup", Kind: "setup"}}
	for _, svc := range env.Services {
		out = append(out, contract.Log{Name: svc.Name, Kind: "service"})
	}
	return out, nil
}

// Bytes of log name from offset, and the offset after them. A log not written yet reads as empty.
func (p *Plane) Log(ctx context.Context, sid, name string, offset int64) ([]byte, int64, error) {
	s, env, err := p.awake(ctx, sid)
	if err != nil {
		return nil, offset, err
	}
	path := ""
	if name == "setup" {
		var seed contract.Seed
		if err := p.Store.Get("seeds", s.Env, &seed); err != nil || seed.Run == "" {
			return nil, offset, nil
		}
		path = fmt.Sprintf("%s/%s/log", Runs, seed.Run)
	}
	for _, svc := range env.Services {
		if svc.Name == name {
			path = fmt.Sprintf("%s/%s.log", Logs, name)
		}
	}
	if path == "" {
		return nil, offset, ErrNotFound
	}
	b, next, err := p.box(s.Actor).Tail(ctx, path, offset)
	if errors.Is(err, box.ErrMissing) {
		return nil, offset, nil
	}
	return b, next, err
}
