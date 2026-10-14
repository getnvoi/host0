package workspace

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/getnvoi/host0/internal/db"
)

// Guards the queue records. Taken after a session's lock, never before it.
var queues sync.Mutex

// A message to a session: run now when it is at rest, queued otherwise, decided under the session's lock. With
// to, it is for the sub-agent that tool call started, and the main agent is asked to pass it on.
func (ws *Workspace) Say(sid, prompt, to string) error {
	unlock := lock(sid)
	defer unlock()
	s, err := ws.load(sid)
	if err != nil {
		return err
	}
	if to != "" {
		runner, _, err := ws.runner()
		if err != nil {
			return err
		}
		if prompt, err = runner.Relay(s.Events, to, prompt); err != nil {
			return err
		}
	}
	switch {
	case s.State == "failed" && !forked(s):
		// The fork never finished: it is made again before anything runs on the sandbox.
		seed, err := ws.served(s.Env)
		if err != nil {
			return err
		}
		if s.Pending != "" {
			if err := ws.enqueue(sid, prompt); err != nil {
				return err
			}
		} else {
			s.Pending = prompt
		}
		s.State, s.Error = "forking", ""
		if err := ws.save(&s); err != nil {
			return err
		}
		c := s
		go ws.begin(&c, seed)
	case s.State == "idle" || s.State == "failed":
		// What was waiting goes first: a prompt that never started, then the queue in order.
		shift := false
		if s.Pending != "" || ws.queued(sid) > 0 {
			if err := ws.enqueue(sid, prompt); err != nil {
				return err
			}
			if s.Pending != "" {
				prompt = s.Pending
			} else {
				prompt, _ = ws.peek(sid)
				shift = true
			}
		}
		// Saved before the message leaves the queue: a crash between the two runs it twice rather than never.
		s.State, s.Pending, s.Error = "running", prompt, ""
		if err := ws.save(&s); err != nil {
			return err
		}
		if shift {
			ws.shift(sid)
		}
		c := s
		go ws.run(context.Background(), &c, prompt)
	default:
		if err := ws.enqueue(sid, prompt); err != nil {
			return err
		}
		ws.announce(&s)
	}
	return nil
}

// The session's queued messages, in order.
func (ws *Workspace) queue(sid string) ([]db.QueuedMessage, error) {
	r, err := rowOf(ws.DB, sid)
	if err != nil {
		return nil, err
	}
	var q []db.QueuedMessage
	return q, ws.DB.Where("session_id = ?", r.ID).Order("position").Find(&q).Error
}

func (ws *Workspace) enqueue(sid, prompt string) error {
	queues.Lock()
	defer queues.Unlock()
	r, err := rowOf(ws.DB, sid)
	if err != nil {
		return err
	}
	var last struct{ N *int }
	if err := ws.DB.Model(&db.QueuedMessage{}).Select("max(position) AS n").Where("session_id = ?", r.ID).Scan(&last).Error; err != nil {
		return err
	}
	next := 0
	if last.N != nil {
		next = *last.N + 1
	}
	return ws.DB.Create(&db.QueuedMessage{SessionID: r.ID, Position: next, Text: prompt}).Error
}

// The first queued message, left in place.
func (ws *Workspace) peek(sid string) (string, bool) {
	queues.Lock()
	defer queues.Unlock()
	q, err := ws.queue(sid)
	if err != nil {
		log.Printf("session %s: its queue: %v", sid, err)
	}
	if len(q) == 0 {
		return "", false
	}
	return q[0].Text, true
}

// Removes the first queued message.
func (ws *Workspace) shift(sid string) {
	queues.Lock()
	defer queues.Unlock()
	q, err := ws.queue(sid)
	if err == nil && len(q) > 0 {
		err = ws.DB.Delete(&q[0]).Error
	}
	if err != nil {
		log.Printf("session %s: its queue: %v", sid, err)
	}
}

// The queue as it stands, for the UI to show and withdraw from.
func (ws *Workspace) Queue(sid string) ([]string, error) {
	queues.Lock()
	defer queues.Unlock()
	q, err := ws.queue(sid)
	out := make([]string, len(q))
	for i, m := range q {
		out[i] = m.Text
	}
	return out, err
}

// Withdraws queued message i, provided it is still text; the check keeps a stale click from removing its neighbour.
func (ws *Workspace) Unqueue(sid string, i int, text string) error {
	unlock := lock(sid)
	defer unlock()
	queues.Lock()
	q, err := ws.queue(sid)
	if err != nil {
		queues.Unlock()
		return err
	}
	if i < 0 || i >= len(q) || q[i].Text != text {
		queues.Unlock()
		return Conflict{fmt.Errorf("that message is no longer queued")}
	}
	err = ws.DB.Delete(&q[i]).Error
	queues.Unlock()
	if err != nil {
		return err
	}
	s, err := ws.load(sid)
	if err != nil {
		return err
	}
	ws.announce(&s)
	return nil
}

func (ws *Workspace) queued(sid string) int {
	queues.Lock()
	defer queues.Unlock()
	q, err := ws.queue(sid)
	if err != nil {
		log.Printf("session %s: its queue: %v", sid, err)
	}
	return len(q)
}
