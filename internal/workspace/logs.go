package workspace

import (
	"context"
	"errors"
	"fmt"

	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/store"
)

// Where each service's output is kept, beside its stdout.
const Logs = "/workspace/.hz/logs"

// The setup script's log, then one per service, in the environment's order.
func (ws *Workspace) Logs(sid string) ([]Log, error) {
	var s Session
	if err := ws.Store.Get("sessions", sid, &s); err != nil {
		return nil, err
	}
	env, _, err := ws.env(s.Env)
	if err != nil {
		return nil, err
	}
	out := []Log{{Name: "setup", Kind: "setup"}}
	for _, svc := range env.Services {
		out = append(out, Log{Name: svc.Name, Kind: "service"})
	}
	return out, nil
}

// Bytes of log name from offset, and the offset after them. A log not written yet reads as empty.
func (ws *Workspace) Log(ctx context.Context, sid, name string, offset int64) ([]byte, int64, error) {
	s, env, err := ws.Awake(ctx, sid)
	if err != nil {
		return nil, offset, err
	}
	path := ""
	if name == "setup" {
		var seed Seed
		if err := ws.Store.Get("seeds", s.Env, &seed); err != nil || seed.Run == "" {
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
		return nil, offset, store.ErrNotFound
	}
	b, next, err := ws.box(s.Actor).Tail(ctx, path, offset)
	if errors.Is(err, box.ErrMissing) {
		return nil, offset, nil
	}
	return b, next, err
}
