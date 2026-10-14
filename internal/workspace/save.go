package workspace

import (
	"log"
	"sync"
	"time"

	"github.com/getnvoi/host0/internal/llm"
)

// Writes the session and announces what changed: its summary, and the events it gained since the last write.
func (ws *Workspace) save(s *Session) error { return ws.keep(s, true) }

// While a turn streams, its session is written at most this often; what it printed is sent to the UI at once.
const flush = 250 * time.Millisecond

// When each session was last written, and whether a write is due for one streaming.
var writes sync.Map

type write struct {
	at  time.Time
	due bool
}

// Events already announced per session, so only the new ones travel.
var sent = struct {
	sync.Mutex
	n map[string]int
}{n: map[string]int{}}

// Saves and announces the session. Unless now, a write this soon after the last is left to a timer.
func (ws *Workspace) keep(s *Session, now bool) error {
	s.Last = time.Now()
	// A list, never null: a session that has not printed anything yet has no events, not unknown ones.
	if s.Events == nil {
		s.Events = []llm.Event{}
	}
	w, _ := writes.Load(s.ID)
	last, _ := w.(write)
	if now || time.Since(last.at) >= flush {
		if err := ws.write(s); err != nil {
			return err
		}
		writes.Store(s.ID, write{at: time.Now()})
	} else if !last.due {
		writes.Store(s.ID, write{at: last.at, due: true})
		time.AfterFunc(flush, func() {
			unlock := lock(s.ID)
			defer unlock()
			if w, _ := writes.Load(s.ID); w.(write).due {
				if err := ws.write(s); err != nil {
					log.Printf("session %s: %v", s.ID, err)
				}
				writes.Store(s.ID, write{at: time.Now()})
			}
		})
	}
	sent.Lock()
	from := sent.n[s.ID]
	if from > len(s.Events) {
		from = 0
	}
	sent.n[s.ID] = len(s.Events)
	sent.Unlock()
	sum := s.Summary()
	sum.Queued = ws.queued(s.ID)
	ws.Bus.Publish(Update{Kind: "session", Session: &sum, From: from, Events: s.Events[from:]})
	return nil
}

// Announces the session's summary alone: its queue changed, not its record.
func (ws *Workspace) announce(s *Session) {
	sum := s.Summary()
	sum.Queued = ws.queued(s.ID)
	sent.Lock()
	from := sent.n[s.ID]
	sent.Unlock()
	ws.Bus.Publish(Update{Kind: "session", Session: &sum, From: from})
}

func (ws *Workspace) saveApproval(a Approval) error {
	if err := ws.putApproval(a); err != nil {
		return err
	}
	ws.Bus.Publish(Update{Kind: "approval", Approval: &a})
	return nil
}

func (ws *Workspace) saveSeed(s *Seed) error {
	if err := ws.putSeed(s); err != nil {
		return err
	}
	c := *s
	ws.Bus.Publish(Update{Kind: "seed", Seed: &c})
	return nil
}
