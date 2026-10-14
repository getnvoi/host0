package workspace

import (
	"context"
	"errors"
	"fmt"

	"github.com/getnvoi/host0/internal/box"
)

// Where each service's output is kept, beside its stdout.
const Logs = "/workspace/.hz/logs"

// The setup script's log, then one per service, in the environment's order.
func (ws *Workspace) Logs(sid string) ([]Log, error) {
	s, err := ws.load(sid)
	if err != nil {
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
		seed, err := ws.served(s.Env)
		if err != nil || seed.Run == "" {
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
		return nil, offset, NotFound{fmt.Errorf("session %s has no log %s", sid, name)}
	}
	b, next, err := ws.box(s.Actor).Tail(ctx, path, offset)
	if errors.Is(err, box.ErrMissing) {
		return nil, offset, nil
	}
	return b, next, err
}
