package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/getnvoi/host0/controlplane/box"
	"github.com/getnvoi/host0/controlplane/claude"
	"github.com/getnvoi/host0/controlplane/llm"
	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

// The agent CLIs a credential may name.
var Runners = []llm.Runner{claude.Runner{}}

// The tools the agent sees; what each does is Plane.perform.
var Tools = []map[string]any{
	{"name": "set_title", "description": "Name this task in a few words.",
		"inputSchema": schema(map[string]string{"title": "string"})},
	{"name": "push_branch", "description": "Push the committed work on this branch to GitHub.",
		"inputSchema": schema(nil)},
	{"name": "create_pull_request", "description": "Push this branch and open a pull request for it. Commit first.",
		"inputSchema": schema(map[string]string{"title": "string", "body": "string"})},
	{"name": "navigate_preview", "description": "Show the user a page of the app in their preview, by its path (/health).",
		"inputSchema": schema(map[string]string{"path": "string"})},
}

// Policies for tools an environment leaves unset: the ones that touch nothing outside the sandbox run at once.
var defaults = map[string]string{"set_title": "auto", "navigate_preview": "auto"}

func policy(env contract.Environment, name string) string {
	if p, ok := env.Tools[name]; ok {
		return p
	}
	return defaults[name]
}

func schema(props map[string]string) map[string]any {
	p := map[string]any{}
	req := []string{}
	for k, t := range props {
		p[k] = map[string]string{"type": t}
		req = append(req, k)
	}
	return map[string]any{"type": "object", "properties": p, "required": req}
}

const instructions = "You work inside a checkout of the repository, your working directory. The app runs from this " +
	"checkout and reloads on change; the user watches it at %s. On your first turn call set_title. When a change shows " +
	"on a page, call navigate_preview with its path so the user sees it. Commit your work. " +
	"Anything that touches GitHub (push, pull request) goes through the hz tools: you have no credentials. " +
	"A hz tool answering 'Queued' is normal: end your turn right after. Answer briefly."

// Opens the prompt that tells a turn what its tools did.
const outcome = "Outcome of the actions you asked for:"

var locks sync.Map

// Guards every write of a session. A turn in progress owns its session's copy and writes it under this lock;
// anything else writes only a session at rest, read afresh under the lock.
func lock(id string) func() {
	m, _ := locks.LoadOrStore(id, &sync.Mutex{})
	m.(*sync.Mutex).Lock()
	return m.(*sync.Mutex).Unlock
}

// Changes the session and saves it, under its lock.
func (p *Plane) put(s *contract.Session, change func()) {
	unlock := lock(s.ID)
	defer unlock()
	change()
	p.save(s)
}

func (p *Plane) Start(name, prompt, by string) (contract.Session, error) {
	seed, err := p.served(name)
	if err != nil {
		return contract.Session{}, err
	}
	sid := id()
	s := contract.Session{ID: sid, Env: name, Actor: "wt-" + sid, Branch: "hz/" + sid, Preview: p.Preview(sid),
		Transcript: uuid(), State: "forking", At: time.Now(), Pending: prompt, By: by}
	if err := p.save(&s); err != nil {
		return s, err
	}
	c := s
	go p.begin(&c, seed)
	return s, nil
}

// Forks, then runs the pending prompt. Every step is idempotent, so a plane that restarts mid-fork runs it again.
func (p *Plane) begin(s *contract.Session, seed contract.Seed) {
	ctx := context.Background()
	if err := p.fork(ctx, s, seed); err != nil {
		p.fail(s, err)
		return
	}
	prompt := s.Pending
	if prompt == "" {
		prompt = p.drain(s)
	}
	p.run(ctx, s, prompt)
}

// A session whose sandbox was made; one that has run a turn was.
func forked(s contract.Session) bool { return s.Forked || s.Turns > 0 }

// Picks up what a restart interrupted: seed builds, decisions, forks, turns, and queues behind a session at rest.
// boxd keeps each turn's log, so following it again rebuilds its events exactly.
func (p *Plane) Recover() {
	var seeds []contract.Seed
	p.Store.List("seeds", func(d func(any) error) error {
		var s contract.Seed
		if d(&s) == nil && s.State == "building" {
			seeds = append(seeds, s)
		}
		return nil
	})
	for _, s := range seeds {
		log.Printf("recover seed %s: interrupted", s.Env)
		s.State, s.Error = "failed", "interrupted by a restart of the plane"
		p.Store.Put("seeds", s.Env, s)
	}
	// A decision cut short is carried out again: whether its action ran is unknown, and every action is safe to repeat.
	var deciding []contract.Approval
	p.Store.List("approvals", func(d func(any) error) error {
		var a contract.Approval
		if d(&a) == nil && a.State == "deciding" {
			deciding = append(deciding, a)
		}
		return nil
	})
	for _, a := range deciding {
		log.Printf("recover approval %s (%s)", a.ID, a.Tool)
		go p.decide(a, a.Allow)
	}
	var sessions []contract.Session
	p.Store.List("sessions", func(d func(any) error) error {
		var s contract.Session
		if d(&s) == nil {
			sessions = append(sessions, s)
		}
		return nil
	})
	ctx := context.Background()
	for _, s := range sessions {
		s := s
		switch {
		case s.State == "forking":
			log.Printf("recover %s (forking)", s.ID)
			seed, err := p.served(s.Env)
			if err != nil {
				p.fail(&s, err)
				continue
			}
			go p.begin(&s, seed)
		case s.State == "running" && s.Pending != "":
			log.Printf("recover %s (running, not started)", s.ID)
			go p.run(ctx, &s, s.Pending)
		case s.State == "running":
			log.Printf("recover %s (running)", s.ID)
			go p.rejoin(ctx, &s)
		case s.State == "awaiting_approval":
			go p.settle(s.ID)
		case s.State == "idle" && p.queued(s.ID) > 0:
			log.Printf("recover %s (idle, queued)", s.ID)
			go p.kick(s.ID)
		}
	}
}

// Follows the session's current turn again, from the first byte of its log, and what comes after it.
func (p *Plane) rejoin(ctx context.Context, s *contract.Session) {
	env, _, err := p.env(s.Env)
	if err != nil {
		p.fail(s, err)
		return
	}
	if err := p.ensure(ctx, s.Actor, env.Tier); err != nil {
		p.fail(s, err)
		return
	}
	s.Events = s.Events[:min(s.Mark+1, len(s.Events))]
	// A turn stopped before boxd started it has no log: it is started again from its prompt.
	if _, _, err := p.box(s.Actor).Tail(ctx, fmt.Sprintf("%s/turn-%d/log", Runs, s.Turns), 0); errors.Is(err, box.ErrMissing) &&
		s.Mark < len(s.Events) && s.Events[s.Mark].Kind == "prompt" {
		prompt := s.Events[s.Mark].Content
		s.Events, s.Turns = s.Events[:s.Mark], s.Turns-1
		p.run(ctx, s, prompt)
		return
	}
	p.run(ctx, s, p.follow(ctx, s, box.Run{}))
}

func (p *Plane) fork(ctx context.Context, s *contract.Session, seed contract.Seed) error {
	env, _, err := p.env(s.Env)
	if err != nil {
		return err
	}
	tier, err := tiers.Get(env.Tier)
	if err != nil {
		return err
	}
	if err := p.Sandboxes.Create(ctx, s.Actor, seed.Template, seed.Tag); err != nil {
		return err
	}
	if err := p.wake(ctx, s.Actor, tier); err != nil {
		return err
	}
	bx := p.box(s.Actor)
	if err := bx.Ready(ctx); err != nil {
		return err
	}
	if err := bx.Must(ctx, "branch", box.Run{Argv: []string{"git", "checkout", "-B", s.Branch}, Dir: App}, nil); err != nil {
		return err
	}
	if err := p.route(ctx, s.Preview, Route{s.Actor, env.Preview, tier.Name}); err != nil {
		return err
	}
	p.put(s, func() { s.State, s.Forked = "running", true })
	return nil
}

func (p *Plane) fail(s *contract.Session, err error) {
	log.Printf("session %s: %v", s.ID, err)
	p.put(s, func() { s.State, s.Error = "failed", err.Error() })
}

// Runs prompt, then every prompt that follows it, until the session comes to rest.
func (p *Plane) run(ctx context.Context, s *contract.Session, prompt string) {
	for prompt != "" {
		prompt = p.turn(ctx, s, prompt)
	}
}

// Stop requests, by session and turn: a request for one turn never ends another.
var stops sync.Map

func stopKey(sid string, turn int) string { return sid + "/" + strconv.Itoa(turn) }

// Runs one turn. Returns the prompt to run next, empty when the session came to rest.
func (p *Plane) turn(ctx context.Context, s *contract.Session, prompt string) string {
	// Saved before anything that can fail or take long: a plane that restarts from here runs the prompt again.
	p.put(s, func() { s.State, s.Pending, s.Error = "running", prompt, "" })
	env, creds, err := p.env(s.Env)
	if err != nil {
		p.fail(s, err)
		return ""
	}
	runner, values, err := llm.Check(Runners, creds.LLM)
	if err != nil {
		p.fail(s, err)
		return ""
	}
	if err := p.ensure(ctx, s.Actor, env.Tier); err != nil {
		p.fail(s, err)
		return ""
	}
	if s.Turns > 0 {
		// The last turn's agent, if a failure left it running, would work beside this one on the same checkout.
		p.end(s.Actor, fmt.Sprintf("turn-%d", s.Turns))
	}
	tools, _ := json.Marshal(Tools)
	argv := runner.Argv(llm.Turn{Prompt: prompt, Session: s.Transcript, Resume: s.Turns > 0, Model: values["model"],
		Instructions: fmt.Sprintf(instructions, origin(s.Preview)), MCP: Boxd})
	stops.Delete(stopKey(s.ID, s.Turns+1))
	p.put(s, func() {
		s.Turns++
		s.Mark = len(s.Events)
		s.Pending = ""
		add(s, contract.Event{Kind: "prompt", Content: prompt})
	})
	run := box.Run{Argv: argv, Dir: App, Env: runner.Env(values)}
	run.Env["HZ_TOOLS"] = string(tools)
	return p.follow(ctx, s, run)
}

// Stops a run if it is still going; one that ended, or a boxd out of reach, leaves nothing to do.
func (p *Plane) end(actor, run string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p.box(actor).Cancel(ctx, run)
}

// How long the agent may stay up after its answer, for its background shells, before the turn ends it.
var linger = 10 * time.Second

// Runs or follows the current turn, then settles its tools: auto at once, approval parked until decided.
// Returns the prompt to run next.
func (p *Plane) follow(ctx context.Context, s *contract.Session, run box.Run) string {
	env, creds, err := p.env(s.Env)
	if err != nil {
		p.fail(s, err)
		return ""
	}
	runner, _, err := llm.Check(Runners, creds.LLM)
	if err != nil {
		p.fail(s, err)
		return ""
	}
	release, err := p.enter(ctx, s.Actor, env.Tier)
	if err != nil {
		p.fail(s, err)
		return ""
	}
	defer release()
	start := len(s.Events)
	rid := fmt.Sprintf("turn-%d", s.Turns)
	var answered sync.Once
	var ended atomic.Bool
	code, err := p.box(s.Actor).Exec(ctx, rid, run, 0, func(line string) {
		evs := runner.Events(line)
		if len(evs) == 0 {
			return
		}
		unlock := lock(s.ID)
		add(s, evs...)
		p.keep(s, false)
		unlock()
		for _, ev := range evs {
			if ev.Kind == "result" {
				// The agent stays up while its background shells run; the turn is over once it has answered.
				answered.Do(func() {
					time.AfterFunc(linger, func() {
						ended.Store(true)
						p.end(s.Actor, rid)
					})
				})
			}
		}
	})
	if err != nil {
		p.end(s.Actor, rid)
		p.fail(s, err)
		return ""
	}
	if ended.Load() {
		code = 0
	}
	if _, stopped := stops.LoadAndDelete(stopKey(s.ID, s.Turns)); stopped {
		p.put(s, func() { add(s, contract.Event{Kind: "stopped"}) })
		return p.drain(s)
	}
	if code != 0 {
		p.put(s, func() {
			add(s, contract.Event{Kind: "notice", Content: fmt.Sprintf("%s exited %d", runner.Label(), code)})
		})
	}
	var outcomes []string
	var asks []contract.Approval
	for _, ev := range s.Events[start:] {
		name, ok := runner.Tool(ev.Tool)
		if ev.Kind != "tool_use" || !ok {
			continue
		}
		switch policy(env, name) {
		case "auto":
			outcomes = append(outcomes, p.act(s, env, creds, name, ev.Content))
		case "approval":
			asks = append(asks, contract.Approval{ID: id(), Session: s.ID, Turn: s.Turns, Tool: name, Input: ev.Content,
				State: "pending", At: time.Now()})
		default:
			outcomes = append(outcomes, name+": refused by policy")
		}
	}
	switch {
	case len(asks) > 0:
		// The auto tools' outcomes wait with the session, to go with the decisions into one outcome turn.
		p.put(s, func() {
			for _, a := range asks {
				p.saveApproval(a)
			}
			s.State, s.Outcomes = "awaiting_approval", outcomes
		})
		return ""
	case code != 0 && transient(runner, s.Events[start:]) && retry(s.ID) <= retryLimit:
		// The agent could not reach its API (DNS, a reset, an overload): its session goes on after a pause, with what
		// the tools it did call came to.
		n, _ := retries.Load(s.ID)
		p.put(s, func() {
			add(s, contract.Event{Kind: "notice", Content: fmt.Sprintf("%s could not reach its API; trying again (%d of %d).", runner.Label(), n, retryLimit)})
		})
		select {
		case <-time.After(time.Duration(n.(int)) * retryPause):
		case <-ctx.Done():
		}
		prompt := again
		if len(outcomes) > 0 {
			prompt = outcome + "\n" + strings.Join(outcomes, "\n") + "\n\n" + again
		}
		p.put(s, func() { s.Pending = prompt })
		return prompt
	case len(outcomes) > 0:
		retries.Delete(s.ID)
		prompt := outcome + "\n" + strings.Join(outcomes, "\n")
		p.put(s, func() { s.Pending = prompt })
		return prompt
	}
	retries.Delete(s.ID)
	return p.drain(s)
}

// What a turn cut short by the API connection is resumed with; the web UI does not show it as a message.
const again = "The connection to the API dropped before you finished. Continue where you left off."

var (
	retries    sync.Map // session id -> attempts in a row
	retryLimit = 2
	retryPause = 10 * time.Second
)

// Counts one more attempt at the session's turn.
func retry(sid string) int {
	for {
		v, loaded := retries.LoadOrStore(sid, 1)
		if !loaded {
			return 1
		}
		if retries.CompareAndSwap(sid, v, v.(int)+1) {
			return v.(int) + 1
		}
	}
}

// Whether the turn ended on a network error rather than something the agent did.
func transient(runner llm.Runner, events []contract.Event) bool {
	for i := len(events) - 1; i >= 0; i-- {
		switch events[i].Kind {
		case "error", "result", "message":
			if runner.Transient(events[i].Content) {
				return true
			}
		}
	}
	return false
}

// The next queued message, saved as the session's intent; with none, the session at rest.
func (p *Plane) drain(s *contract.Session) string {
	unlock := lock(s.ID)
	defer unlock()
	return p.advance(s)
}

// drain, with the session's lock held. The intent is saved before the message leaves the queue, so a restart in
// between repeats it rather than loses it.
func (p *Plane) advance(s *contract.Session) string {
	prompt, ok := p.peek(s.ID)
	if !ok {
		s.State, s.Pending = "idle", ""
		p.save(s)
		return ""
	}
	s.State, s.Pending = "running", prompt
	p.save(s)
	p.shift(s.ID)
	p.announce(s)
	return prompt
}

// Runs the next queued message of a session at rest.
func (p *Plane) kick(sid string) {
	unlock := lock(sid)
	var s contract.Session
	if p.Store.Get("sessions", sid, &s) != nil || s.State != "idle" || p.queued(sid) == 0 {
		unlock()
		return
	}
	prompt := p.advance(&s)
	unlock()
	p.run(context.Background(), &s, prompt)
}

// Appends events stamped with the time they arrived.
func add(s *contract.Session, evs ...contract.Event) {
	now := time.Now()
	for _, ev := range evs {
		ev.At = now
		s.Events = append(s.Events, ev)
	}
}

// Stops the running turn: its process group is signalled, and the turn ends as stopped rather than failed. A tool
// being carried out for the session is cut short too.
func (p *Plane) Stop(ctx context.Context, sid string) error {
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return err
	}
	halted := p.halt(ctx, sid)
	if s.State != "running" {
		if halted {
			return nil
		}
		return fmt.Errorf("session %s is %s", sid, s.State)
	}
	key := stopKey(sid, s.Turns)
	stops.Store(key, true)
	if err := p.box(s.Actor).Cancel(ctx, fmt.Sprintf("turn-%d", s.Turns)); err != nil {
		stops.Delete(key)
		if halted {
			return nil
		}
		return err
	}
	return nil
}

// One request to the port, through boxd as the preview goes: the status, or the error that stopped it. It asks for
// /favicon.ico, usually a static file, so the app's own pages (which may write on every visit) never run for it.
func (p *Plane) probe(ctx context.Context, actor string, port int, timeout time.Duration) (int, error) {
	c := &http.Client{Timeout: timeout, Transport: &http.Transport{DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return p.Sandboxes.Dial(ctx, actor, box.Port)
		}}}
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost/favicon.ico", nil)
	if err := p.keyed(ctx, actor); err != nil {
		return 0, err
	}
	req.Header.Set(box.TokenHeader, p.derive("actor", actor))
	req.Header.Set(box.ProxyHeader, strconv.Itoa(port))
	res, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	res.Body.Close()
	return res.StatusCode, nil
}

// Waits until the port answers HTTP with anything but a gateway error.
func (p *Plane) answers(ctx context.Context, actor string, port int) error {
	var last string
	for deadline := time.Now().Add(10 * time.Minute); time.Now().Before(deadline); time.Sleep(3 * time.Second) {
		code, err := p.probe(ctx, actor, port, 30*time.Second)
		if err != nil {
			last = err.Error()
			continue
		}
		if code < 500 {
			return nil
		}
		last = http.StatusText(code)
	}
	return fmt.Errorf("%s:%d never answered: %s", actor, port, last)
}

// Whether the session's app answers its preview, waking the sandbox first. Up is any status below 500.
func (p *Plane) PreviewStatus(ctx context.Context, sid string) (contract.PreviewStatus, error) {
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return contract.PreviewStatus{}, err
	}
	var rt Route
	if err := p.Store.Get("routes", s.Preview, &rt); err != nil {
		return contract.PreviewStatus{}, err
	}
	if err := p.ensure(ctx, rt.Actor, rt.Tier); err != nil {
		return contract.PreviewStatus{Error: err.Error()}, nil
	}
	code, err := p.probe(ctx, rt.Actor, rt.Port, 5*time.Second)
	if err != nil {
		return contract.PreviewStatus{Error: err.Error()}, nil
	}
	return contract.PreviewStatus{Status: code, Up: code < 500}, nil
}

// Frees the session's worker; the next preview request or turn resumes it where it was.
func (p *Plane) Suspend(ctx context.Context, sid string) error {
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return err
	}
	return p.Sandboxes.Suspend(ctx, s.Actor)
}

// Running, or resumed with room made for it: the router alone would hold the request with nobody growing the pool.
func (p *Plane) ensure(ctx context.Context, actor, tierName string) error {
	g := guard(actor)
	g.Lock()
	defer g.Unlock()
	return p.resume(ctx, actor, tierName)
}

// ensure, with the actor's guard already held.
func (p *Plane) resume(ctx context.Context, actor, tierName string) error {
	p.touch(actor)
	if state, err := p.Sandboxes.State(ctx, actor); err != nil || state == "running" {
		return err
	}
	tier, err := tiers.Get(tierName)
	if err != nil {
		return err
	}
	return p.wake(ctx, actor, tier)
}
