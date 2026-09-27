package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/getnvoi/host0/controlplane/box"
	"github.com/getnvoi/host0/shared/contract"
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

// Runs a tool the agent asked for, within performLimit; the answer is what the agent is told.
func (p *Plane) act(s *contract.Session, env contract.Environment, creds contract.Credentials, name, input string) string {
	ctx, cancel := context.WithTimeout(context.Background(), performLimit)
	w := &work{sid: s.ID, actor: s.Actor, cancel: cancel}
	works.Lock()
	works.m[w] = true
	works.Unlock()
	out := p.perform(ctx, w, s, env, creds, name, input)
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

// Cuts short every tool being carried out for the session. False when there was none.
func (p *Plane) halt(ctx context.Context, sid string) bool {
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
			p.box(w.actor).Cancel(ctx, run)
		}
	}
	return len(runs) > 0
}

// The tool itself. A push never waits on a hook or a credential prompt.
func (p *Plane) perform(ctx context.Context, w *work, s *contract.Session, env contract.Environment, creds contract.Credentials, name, input string) string {
	var in struct{ Title, Body, Path string }
	json.Unmarshal([]byte(input), &in)
	push := func() error {
		// The credential goes in git's environment config, not its arguments, which any process in the box can list.
		script := `git push --no-verify -q -f origin "HEAD:refs/heads/$BRANCH"`
		auth := "Authorization: Basic " + basic("x-access-token:"+creds.GitHub)
		run := "push-" + id()
		works.Lock()
		w.run = run
		works.Unlock()
		return p.box(s.Actor).Must(ctx, run, box.Run{Argv: sh(script), Dir: App,
			Env: map[string]string{"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.extraheader", "GIT_CONFIG_VALUE_0": auth,
				"BRANCH": s.Branch, "GIT_TERMINAL_PROMPT": "0"}}, nil)
	}
	switch name {
	case "set_title":
		s.Title = in.Title
		return "set_title: done"
	case "navigate_preview":
		if !strings.HasPrefix(in.Path, "/") {
			return "navigate_preview: a path starting with / is needed"
		}
		return "navigate_preview: the preview shows " + in.Path
	case "push_branch":
		if err := push(); err != nil {
			return "push_branch: failed: " + err.Error()
		}
		return "push_branch: pushed " + s.Branch
	case "create_pull_request":
		if err := push(); err != nil {
			return "create_pull_request: push failed: " + err.Error()
		}
		url, err := p.Forge.PullRequest(ctx, creds.GitHub, env.Repo, s.Branch, env.Branch, in.Title, in.Body)
		if err != nil {
			return "create_pull_request: failed: " + err.Error()
		}
		return "create_pull_request: opened " + url
	}
	return name + ": unknown tool"
}

// A request that lost to another: answered 409.
type conflict struct{ error }

// Makes pending -> deciding one step, so a second click cannot decide twice.
var decisions sync.Mutex

// Takes the decision and returns at once; the action and the outcome turn follow in the background.
func (p *Plane) Decide(aid string, approve bool, by string) (contract.Approval, error) {
	decisions.Lock()
	var a contract.Approval
	if err := p.Store.Get("approvals", aid, &a); err != nil {
		decisions.Unlock()
		return a, err
	}
	if a.State != "pending" {
		decisions.Unlock()
		return a, conflict{fmt.Errorf("approval %s is %s", aid, a.State)}
	}
	a.State, a.By, a.Allow = "deciding", by, approve
	err := p.saveApproval(a)
	decisions.Unlock()
	if err != nil {
		return a, err
	}
	go p.decide(a, approve)
	return a, nil
}

func (p *Plane) decide(a contract.Approval, approve bool) {
	var s contract.Session
	err := p.Store.Get("sessions", a.Session, &s)
	switch {
	case !approve:
		a.Outcome, a.State = a.Tool+": denied by the user", "denied"
	case err != nil:
		a.Outcome, a.State = a.Tool+": failed: "+err.Error(), "failed"
	default:
		env, creds, err := p.env(s.Env)
		if err == nil {
			err = p.ensure(context.Background(), s.Actor, env.Tier)
		}
		if err != nil {
			a.Outcome, a.State = a.Tool+": failed: "+err.Error(), "failed"
			break
		}
		title := s.Title
		a.Outcome, a.State = p.act(&s, env, creds, a.Tool, a.Input), "done"
		if failed(a.Outcome) {
			a.State = "failed"
		} else if strings.HasSuffix(a.Outcome, ": stopped by the user") {
			a.State = "stopped"
		}
		if s.Title != title {
			p.retitle(s.ID, s.Title)
		}
	}
	a.Decided = time.Now()
	p.saveApproval(a)
	p.settle(a.Session)
}

// Sets the title of a session waiting on approvals.
func (p *Plane) retitle(sid, title string) {
	unlock := lock(sid)
	defer unlock()
	var s contract.Session
	if p.Store.Get("sessions", sid, &s) != nil || s.State != "awaiting_approval" {
		return
	}
	s.Title = title
	p.save(&s)
}

// Whether the session's current turn asked for a. One without a turn counts by its time against the turn's prompt.
func asked(s contract.Session, a contract.Approval) bool {
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
func (p *Plane) settle(sid string) {
	unlock := lock(sid)
	var s contract.Session
	if p.Store.Get("sessions", sid, &s) != nil || s.State != "awaiting_approval" {
		unlock()
		return
	}
	var done []contract.Approval
	open := false
	p.Store.List("approvals", func(d func(any) error) error {
		var a contract.Approval
		if d(&a) != nil || !asked(s, a) {
			return nil
		}
		if a.State == "pending" || a.State == "deciding" {
			open = true
		} else {
			done = append(done, a)
		}
		return nil
	})
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
	prompt := outcome + "\n" + strings.Join(lines, "\n")
	s.State, s.Pending, s.Outcomes = "running", prompt, nil
	p.save(&s)
	unlock()
	p.run(context.Background(), &s, prompt)
}

// Whether an action's outcome line ("<tool>: <what happened>") reports a failure.
func failed(outcome string) bool {
	_, said, _ := strings.Cut(outcome, ": ")
	return strings.HasPrefix(said, "failed:") || strings.HasPrefix(said, "push failed:")
}
