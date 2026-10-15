package workspace

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// How long one tool may take, a push or a pull request.
const performLimit = 5 * time.Minute

// A tool being carried out, so Stop can cut it short: its context, and the boxd run it waits on.
type work struct {
	sid, actor, run string
	cancel          context.CancelFunc
	halted          bool
}

var works = struct {
	sync.Mutex
	m map[*work]bool
}{m: map[*work]bool{}}

type workKey struct{}

// Runs a tool the agent asked for, within performLimit, as the session's agent; the answer is what the agent is told.
func (ws *Workspace) act(s *Session, name, input string) string {
	ctx, cancel := context.WithTimeout(context.Background(), performLimit)
	w := &work{sid: s.ID, actor: s.Actor, cancel: cancel}
	works.Lock()
	works.m[w] = true
	works.Unlock()
	out := ws.Tools.Call(context.WithValue(ctx, workKey{}, w), s.ID, s.Agent, name, input)
	// An operation may have named the session; this copy is written back after it.
	if r, err := rowOf(ws.DB, s.ID); err == nil {
		s.Title = r.Title
	}
	works.Lock()
	delete(works.m, w)
	halted := w.halted
	works.Unlock()
	cancel()
	if halted {
		return name + ": stopped by the user"
	}
	return out
}

// Tells the tool being carried out under ctx, if any, of the boxd run it waits on, so a stop can end it.
func started(ctx context.Context, run string) {
	if w, ok := ctx.Value(workKey{}).(*work); ok {
		works.Lock()
		w.run = run
		works.Unlock()
	}
}

// Cuts short every tool being carried out for the session. False when there was none.
func (ws *Workspace) halt(ctx context.Context, sid string) bool {
	works.Lock()
	var runs []*work
	for w := range works.m {
		if w.sid != sid {
			continue
		}
		w.halted = true
		w.cancel()
		runs = append(runs, w)
	}
	works.Unlock()
	for _, w := range runs {
		works.Lock()
		run := w.run
		works.Unlock()
		if run != "" {
			ws.box(w.actor).Cancel(ctx, run)
		}
	}
	return len(runs) > 0
}

// A request that lost to another: answered 409.
type Conflict struct{ error }

// A request that cannot be carried out as it is: answered 400.
type Invalid struct{ error }

// What a request names does not exist: answered 404.
type NotFound struct{ error }

// Makes pending -> deciding one step, so a second click cannot decide twice.
var decisions sync.Mutex

// Takes the decision and returns at once; the action and the outcome turn follow in the background.
func (ws *Workspace) Decide(aid string, approve bool, by string) (Approval, error) {
	decisions.Lock()
	a, err := ws.Approval(aid)
	if err != nil {
		decisions.Unlock()
		return a, err
	}
	if a.State != "pending" {
		decisions.Unlock()
		return a, Conflict{fmt.Errorf("approval %s is %s", aid, a.State)}
	}
	a.State, a.By, a.Allow = "deciding", by, approve
	err = ws.saveApproval(a)
	decisions.Unlock()
	if err != nil {
		return a, err
	}
	ws.background.Add(1)
	go func() {
		defer ws.background.Done()
		ws.decide(a, approve)
	}()
	return a, nil
}

func (ws *Workspace) decide(a Approval, approve bool) {
	s, err := ws.load(a.Session)
	switch {
	case !approve:
		a.Outcome, a.State = a.Tool+": denied by the user", "denied"
	case err != nil:
		a.Outcome, a.State = a.Tool+": failed: "+err.Error(), "failed"
	default:
		a.Outcome, a.State = ws.act(&s, a.Tool, a.Input), "done"
		if failed(a.Outcome) {
			a.State = "failed"
		} else if strings.HasSuffix(a.Outcome, ": stopped by the user") {
			a.State = "stopped"
		}
	}
	a.Decided = time.Now()
	ws.saveApproval(a)
	ws.settle(a.Session)
}

// Whether the session's current turn asked for a. One without a turn counts by its time against the turn's prompt.
func asked(s Session, a Approval) bool {
	if a.Session != s.ID {
		return false
	}
	if a.Turn != 0 {
		return a.Turn == s.Turns
	}
	return s.Mark < len(s.Events) && !a.At.Before(s.Events[s.Mark].At)
}

// Once every approval the turn asked for is decided, runs the outcome turn: every decision, and the outcomes of
// the auto tools that ran alongside.
func (ws *Workspace) settle(sid string) {
	unlock := lock(sid)
	s, err := ws.load(sid)
	if err != nil || s.State != "awaiting_approval" {
		unlock()
		return
	}
	all, err := ws.Approvals(sid)
	if err != nil {
		unlock()
		ws.fail(&s, err)
		return
	}
	var done []Approval
	open := false
	for _, a := range all {
		if !asked(s, a) {
			continue
		}
		if a.State == "pending" || a.State == "deciding" {
			open = true
		} else {
			done = append(done, a)
		}
	}
	if open {
		unlock()
		return
	}
	sort.Slice(done, func(i, j int) bool {
		if !done[i].At.Equal(done[j].At) {
			return done[i].At.Before(done[j].At)
		}
		return done[i].ID < done[j].ID
	})
	lines := append([]string{}, s.Outcomes...)
	for _, a := range done {
		lines = append(lines, a.Outcome)
	}
	prompt := Outcome + "\n" + strings.Join(lines, "\n")
	s.State, s.Pending, s.Outcomes = "running", prompt, nil
	ws.save(&s)
	unlock()
	ws.run(context.Background(), &s, prompt)
}

// Whether an action's outcome line ("<tool>: <what happened>") reports a failure.
func failed(outcome string) bool {
	_, said, _ := strings.Cut(outcome, ": ")
	return strings.HasPrefix(said, "failed:")
}
