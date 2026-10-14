package workspace

import (
	"context"
	"log"

	"github.com/getnvoi/host0/internal/box"
)

func (ws *Workspace) Terminals(ctx context.Context, sid string) ([]box.Terminal, error) {
	s, _, err := ws.Awake(ctx, sid)
	if err != nil {
		return nil, err
	}
	return ws.box(s.Actor).Terminals(ctx)
}

func (ws *Workspace) Kill(ctx context.Context, sid, tid string) error {
	if !box.TerminalID.MatchString(tid) {
		return Invalid{box.ErrBadTerminal}
	}
	s, _, err := ws.Awake(ctx, sid)
	if err != nil {
		return err
	}
	return ws.box(s.Actor).Kill(ctx, tid)
}

// Every actor a record names: a session's, a ready seed's, and the one a build is making.
func (ws *Workspace) Named() map[string]bool {
	out := map[string]bool{}
	sessions, err := ws.sessions(false, false)
	if err != nil {
		log.Printf("session actors: %v", err)
	}
	for _, s := range sessions {
		out[s.Actor] = true
	}
	seeds, err := ws.Seeds()
	if err != nil {
		log.Printf("seed actors: %v", err)
	}
	for _, s := range seeds {
		if s.Actor != "" && (s.State == "ready" || s.State == "building") {
			out[s.Actor] = true
		}
	}
	return out
}
