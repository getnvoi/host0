package controlplane

import (
	"context"
	"fmt"
	"sync"

	"github.com/getnvoi/nvoi/shared/contract"
)

// Guards the queue records. Taken after a session's lock, never before it.
var queues sync.Mutex

// A message to a session: run now when it is at rest, queued otherwise, decided under the session's lock. With
// to, it is for the sub-agent that tool call started, and the main agent is asked to pass it on.
func (p *Plane) Say(sid, prompt, to string) error {
	unlock := lock(sid)
	defer unlock()
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return err
	}
	if to != "" {
		runner, _, err := p.runner()
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
		seed, err := p.served(s.Env)
		if err != nil {
			return err
		}
		if s.Pending != "" {
			if err := p.enqueue(sid, prompt); err != nil {
				return err
			}
		} else {
			s.Pending = prompt
		}
		s.State, s.Error = "forking", ""
		if err := p.save(&s); err != nil {
			return err
		}
		c := s
		go p.begin(&c, seed)
	case s.State == "idle" || s.State == "failed":
		// What was waiting goes first: a prompt that never started, then the queue in order.
		shift := false
		if s.Pending != "" || p.queued(sid) > 0 {
			if err := p.enqueue(sid, prompt); err != nil {
				return err
			}
			if s.Pending != "" {
				prompt = s.Pending
			} else {
				prompt, _ = p.peek(sid)
				shift = true
			}
		}
		// Saved before the message leaves the queue: a crash between the two runs it twice rather than never.
		s.State, s.Pending, s.Error = "running", prompt, ""
		if err := p.save(&s); err != nil {
			return err
		}
		if shift {
			p.shift(sid)
		}
		c := s
		go p.run(context.Background(), &c, prompt)
	default:
		if err := p.enqueue(sid, prompt); err != nil {
			return err
		}
		p.announce(&s)
	}
	return nil
}

func (p *Plane) enqueue(sid, prompt string) error {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	p.Store.Get("queue", sid, &q)
	return p.Store.Put("queue", sid, append(q, prompt))
}

// The first queued message, left in place.
func (p *Plane) peek(sid string) (string, bool) {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	if p.Store.Get("queue", sid, &q) != nil || len(q) == 0 {
		return "", false
	}
	return q[0], true
}

// Removes the first queued message.
func (p *Plane) shift(sid string) {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	if p.Store.Get("queue", sid, &q) != nil || len(q) == 0 {
		return
	}
	p.Store.Put("queue", sid, q[1:])
}

// The queue as it stands, for the UI to show and withdraw from.
func (p *Plane) Queue(sid string) []string {
	queues.Lock()
	defer queues.Unlock()
	q := []string{}
	p.Store.Get("queue", sid, &q)
	return q
}

// Withdraws queued message i, provided it is still text; the check keeps a stale click from removing its neighbour.
func (p *Plane) Unqueue(sid string, i int, text string) error {
	unlock := lock(sid)
	defer unlock()
	queues.Lock()
	var q []string
	p.Store.Get("queue", sid, &q)
	if i < 0 || i >= len(q) || q[i] != text {
		queues.Unlock()
		return fmt.Errorf("that message is no longer queued")
	}
	err := p.Store.Put("queue", sid, append(q[:i:i], q[i+1:]...))
	queues.Unlock()
	if err != nil {
		return err
	}
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return err
	}
	p.announce(&s)
	return nil
}

func (p *Plane) queued(sid string) int {
	queues.Lock()
	defer queues.Unlock()
	var q []string
	p.Store.Get("queue", sid, &q)
	return len(q)
}
