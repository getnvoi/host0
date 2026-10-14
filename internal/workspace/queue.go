package workspace

import (
	"context"
	"fmt"
	"sync"
)

// Guards the queue records. Taken after a session's lock, never before it.
var queues sync.Mutex

// A message to a session: run now when it is at rest, queued otherwise, decided under the session's lock. With
// to, it is for the sub-agent that tool call started, and the main agent is asked to pass it on.
func (ws *Workspace) Say(sid, prompt, to string) error {
	unlock := lock(sid)
	defer unlock()
	var s Session
	if err := ws.Store.Get("sessions", sid, &s); err != nil {
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

func (ws *Workspace) enqueue(sid, prompt string) error {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	ws.Store.Get("queue", sid, &q)
	return ws.Store.Put("queue", sid, append(q, prompt))
}

// The first queued message, left in place.
func (ws *Workspace) peek(sid string) (string, bool) {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	if ws.Store.Get("queue", sid, &q) != nil || len(q) == 0 {
		return "", false
	}
	return q[0], true
}

// Removes the first queued message.
func (ws *Workspace) shift(sid string) {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	if ws.Store.Get("queue", sid, &q) != nil || len(q) == 0 {
		return
	}
	ws.Store.Put("queue", sid, q[1:])
}

// The queue as it stands, for the UI to show and withdraw from.
func (ws *Workspace) Queue(sid string) []string {
	queues.Lock()
	defer queues.Unlock()
	q := []string{}
	ws.Store.Get("queue", sid, &q)
	return q
}

// Withdraws queued message i, provided it is still text; the check keeps a stale click from removing its neighbour.
func (ws *Workspace) Unqueue(sid string, i int, text string) error {
	unlock := lock(sid)
	defer unlock()
	queues.Lock()
	var q []string
	ws.Store.Get("queue", sid, &q)
	if i < 0 || i >= len(q) || q[i] != text {
		queues.Unlock()
		return fmt.Errorf("that message is no longer queued")
	}
	err := ws.Store.Put("queue", sid, append(q[:i:i], q[i+1:]...))
	queues.Unlock()
	if err != nil {
		return err
	}
	var s Session
	if err := ws.Store.Get("sessions", sid, &s); err != nil {
		return err
	}
	ws.announce(&s)
	return nil
}

func (ws *Workspace) queued(sid string) int {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	ws.Store.Get("queue", sid, &q)
	return len(q)
}
