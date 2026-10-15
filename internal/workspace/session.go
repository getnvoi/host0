package workspace

import (
	"cmp"
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

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/box"
	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/sandbox"
)

const instructions = "You work inside a checkout of the repository, your working directory. The app runs from this " +
	"checkout and reloads on change; the user watches it at %s. Your session's id is %s. On your first turn call " +
	"session_title. When a change shows on a page, call session_navigate with its path so the user sees it. Commit your " +
	"work. The hz tools are the hz plane's API; anything that touches GitHub (session_push, session_pr) goes through " +
	"them: you have no credentials. A hz tool answering 'Queued' is normal: end your turn right after. Answer briefly."

// Opens the prompt that tells a turn what its tools did.
const Outcome = "Outcome of the actions you asked for:"

var locks sync.Map

// Guards every write of a session. A turn in progress owns its session's copy and writes it under this lock;
// anything else writes only a session at rest, read afresh under the lock.
func lock(id string) func() {
	m, _ := locks.LoadOrStore(id, &sync.Mutex{})
	m.(*sync.Mutex).Lock()
	return m.(*sync.Mutex).Unlock
}

// Changes the session and saves it, under its lock.
func (ws *Workspace) put(s *Session, change func()) {
	unlock := lock(s.ID)
	defer unlock()
	change()
	ws.save(s)
}

func (ws *Workspace) Start(name, agent, prompt, by string) (Session, error) {
	agent = cmp.Or(agent, agentName)
	if _, err := agentRow(ws.DB, agent); err != nil {
		return Session{}, err
	}
	seed, err := ws.served(name)
	if err != nil {
		return Session{}, err
	}
	sid := id()
	s := Session{ID: sid, Env: name, Agent: agent, Actor: "wt-" + sid, Branch: "hz/" + sid, Preview: ws.Preview(sid),
		State: "forking", At: time.Now(), Pending: prompt, By: by}
	if err := ws.save(&s); err != nil {
		return s, err
	}
	c := s
	go ws.begin(&c, seed)
	return s, nil
}

// Forks, then runs the pending prompt. Every step is idempotent, so a plane that restarts mid-fork runs it again.
func (ws *Workspace) begin(s *Session, seed Seed) {
	ctx := context.Background()
	if err := ws.fork(ctx, s, seed); err != nil {
		ws.fail(s, err)
		return
	}
	prompt := s.Pending
	if prompt == "" {
		prompt = ws.drain(s)
	}
	ws.run(ctx, s, prompt)
}

// A session whose sandbox was made; one that has run a turn was.
func forked(s Session) bool { return s.Forked || s.Turns > 0 }

// Picks up what a restart interrupted: seed builds, decisions, forks, turns, and queues behind a session at rest.
// boxd keeps each turn's log, so following it again rebuilds its events exactly.
func (ws *Workspace) Recover() {
	var rows []db.Seed
	if err := ws.DB.Where("state = ?", "building").Find(&rows).Error; err != nil {
		log.Printf("recover seeds: %v", err)
	}
	for _, r := range rows {
		log.Printf("recover seed %d: interrupted", r.ID)
		if err := ws.DB.Model(&r).Updates(map[string]any{"state": "failed", "error": "interrupted by a restart of the plane"}).Error; err != nil {
			log.Printf("recover seed %d: %v", r.ID, err)
		}
	}
	// A decision cut short is carried out again: whether its action ran is unknown, and every action is safe to repeat.
	deciding, err := ws.Approvals("", "deciding")
	if err != nil {
		log.Printf("recover approvals: %v", err)
	}
	for _, a := range deciding {
		log.Printf("recover approval %s (%s)", a.ID, a.Tool)
		go ws.decide(a, a.Allow)
	}
	sessions, err := ws.sessions(false, true)
	if err != nil {
		log.Printf("recover sessions: %v", err)
	}
	ctx := context.Background()
	for _, s := range sessions {
		s := s
		switch {
		case s.State == "forking":
			log.Printf("recover %s (forking)", s.ID)
			seed, err := ws.served(s.Env)
			if err != nil {
				ws.fail(&s, err)
				continue
			}
			go ws.begin(&s, seed)
		case s.State == "running" && s.Pending != "":
			log.Printf("recover %s (running, not started)", s.ID)
			go ws.run(ctx, &s, s.Pending)
		case s.State == "running":
			log.Printf("recover %s (running)", s.ID)
			go ws.rejoin(ctx, &s)
		case s.State == "awaiting_approval":
			go ws.settle(s.ID)
		case s.State == "idle" && ws.queued(s.ID) > 0:
			log.Printf("recover %s (idle, queued)", s.ID)
			go ws.kick(s.ID)
		}
	}
}

// Follows the session's current turn again, from the first byte of its log, and what comes after it.
func (ws *Workspace) rejoin(ctx context.Context, s *Session) {
	env, _, err := ws.env(s.Env)
	if err != nil {
		ws.fail(s, err)
		return
	}
	if err := ws.Workers.Ensure(ctx, s.Actor, env.Tier); err != nil {
		ws.fail(s, err)
		return
	}
	// A turn stopped before boxd started it has no log: it is started again from its prompt, already stored.
	if _, _, err := ws.box(s.Actor).Tail(ctx, fmt.Sprintf("%s/turn-%d/log", Runs, s.Turns), 0); errors.Is(err, box.ErrMissing) &&
		s.Mark < len(s.Events) && s.Events[s.Mark].Kind == "prompt" {
		ws.run(ctx, s, ws.take(ctx, s, s.Events[s.Mark].Content, true))
		return
	}
	// Events are append-only: those stored after the prompt come out of the log again, and only what follows is new.
	ws.run(ctx, s, ws.follow(ctx, s, box.Run{}, max(len(s.Events)-(s.Mark+1), 0)))
}

func (ws *Workspace) fork(ctx context.Context, s *Session, seed Seed) error {
	env, _, err := ws.env(s.Env)
	if err != nil {
		return err
	}
	tier, err := ws.Workers.Tier(env.Tier)
	if err != nil {
		return err
	}
	if err := ws.Sandboxes.Create(ctx, s.Actor, seed.Template, seed.Tag); err != nil {
		return err
	}
	ctx = sandbox.WithProgress(ctx, func(line string) {
		ws.put(s, func() { add(s, llm.Event{Kind: "notice", Content: line}) })
	})
	if err := ws.Workers.Wake(ctx, s.Actor, tier); err != nil {
		return err
	}
	bx := ws.box(s.Actor)
	if err := bx.Ready(ctx); err != nil {
		return err
	}
	if err := bx.Must(ctx, "branch", box.Run{Argv: []string{"git", "checkout", "-B", s.Branch}, Dir: App}, nil); err != nil {
		return err
	}
	if err := ws.route(ctx, s.Preview, sandbox.Route{Actor: s.Actor, Port: env.Preview, Tier: tier.Name}); err != nil {
		return err
	}
	ws.put(s, func() {
		s.State, s.Forked = "running", true
		add(s, llm.Event{Kind: "notice", Content: fmt.Sprintf("forked in %s", time.Since(s.At).Round(100*time.Millisecond))})
	})
	return nil
}

func (ws *Workspace) fail(s *Session, err error) {
	log.Printf("session %s: %v", s.ID, err)
	ws.put(s, func() { s.State, s.Error = "failed", err.Error() })
}

// Runs prompt, then every prompt that follows it, until the session comes to rest.
func (ws *Workspace) run(ctx context.Context, s *Session, prompt string) {
	for prompt != "" {
		prompt = ws.turn(ctx, s, prompt)
	}
}

// Stop requests, by session and turn: a request for one turn never ends another.
var stops sync.Map

func stopKey(sid string, turn int) string { return sid + "/" + strconv.Itoa(turn) }

// Runs one turn. Returns the prompt to run next, empty when the session came to rest.
func (ws *Workspace) turn(ctx context.Context, s *Session, prompt string) string {
	return ws.take(ctx, s, prompt, false)
}

// Runs the turn of prompt: a new one, or again the current one whose prompt is stored and whose run never started.
func (ws *Workspace) take(ctx context.Context, s *Session, prompt string, again bool) string {
	// Saved before anything that can fail or take long: a plane that restarts from here runs the prompt again.
	ws.put(s, func() { s.State, s.Pending, s.Error = "running", prompt, "" })
	env, _, err := ws.env(s.Env)
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	runner, values, err := ws.runner()
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	if err := ws.Workers.Ensure(ctx, s.Actor, env.Tier); err != nil {
		ws.fail(s, err)
		return ""
	}
	if s.Turns > 0 && !again {
		// The last turn's agent, if a failure left it running, would work beside this one on the same checkout.
		ws.end(s.Actor, fmt.Sprintf("turn-%d", s.Turns))
	}
	agent, err := agentRow(ws.DB, s.Agent)
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	given, err := ws.given(s.Agent)
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	tools, err := json.Marshal(given)
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	// The agent's own instructions follow the workspace's; its model, when it names one, replaces the credential's.
	argv := runner.Argv(llm.Turn{Prompt: prompt, Session: s.Transcript, Model: cmp.Or(agent.Model, values["model"]),
		Instructions: strings.TrimSpace(fmt.Sprintf(instructions, origin(s.Preview), s.ID) + "\n\n" + agent.Instructions),
		MCP:          Boxd})
	if !again {
		stops.Delete(stopKey(s.ID, s.Turns+1))
	}
	ws.put(s, func() {
		s.Pending = ""
		if !again {
			s.Turns++
			s.Mark = len(s.Events)
			add(s, llm.Event{Kind: "prompt", Content: prompt})
		}
	})
	run := box.Run{Argv: argv, Dir: App, Env: runner.Env(values)}
	run.Env["HZ_TOOLS"] = string(tools)
	return ws.follow(ctx, s, run, 0)
}

// Stops a run if it is still going; one that ended, or a boxd out of reach, leaves nothing to do.
func (ws *Workspace) end(actor, run string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ws.box(actor).Cancel(ctx, run)
}

// How long the agent may stay up after its answer, for its background shells, before the turn ends it.
var linger = 10 * time.Second

// Runs or follows the current turn, then settles its tools: auto at once, approval parked until decided. The first
// seen events its output yields are stored already. Returns the prompt to run next.
func (ws *Workspace) follow(ctx context.Context, s *Session, run box.Run, seen int) string {
	env, _, err := ws.env(s.Env)
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	runner, _, err := ws.runner()
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	release, err := ws.Workers.Enter(ctx, s.Actor, env.Tier)
	if err != nil {
		ws.fail(s, err)
		return ""
	}
	defer release()
	start := len(s.Events) - seen
	rid := fmt.Sprintf("turn-%d", s.Turns)
	var answered sync.Once
	var ended atomic.Bool
	code, err := ws.box(s.Actor).Exec(ctx, rid, run, 0, func(line string) {
		evs := runner.Events(line)
		if seen > 0 {
			drop := min(seen, len(evs))
			evs, seen = evs[drop:], seen-drop
		}
		id := runner.Transcript(line)
		if len(evs) == 0 && (id == "" || id == s.Transcript) {
			return
		}
		unlock := lock(s.ID)
		add(s, evs...)
		// The next turn resumes this conversation, so its id is saved at once.
		fresh := id != "" && id != s.Transcript
		if fresh {
			s.Transcript = id
		}
		ws.keep(s, fresh)
		unlock()
		for _, ev := range evs {
			if ev.Kind == "result" {
				// The agent stays up while its background shells run; the turn is over once it has answered.
				answered.Do(func() {
					time.AfterFunc(linger, func() {
						ended.Store(true)
						ws.end(s.Actor, rid)
					})
				})
			}
		}
	})
	if err != nil {
		ws.end(s.Actor, rid)
		ws.fail(s, err)
		return ""
	}
	if ended.Load() {
		code = 0
	}
	if _, stopped := stops.LoadAndDelete(stopKey(s.ID, s.Turns)); stopped {
		ws.put(s, func() { add(s, llm.Event{Kind: "stopped"}) })
		return ws.drain(s)
	}
	if code != 0 {
		ws.put(s, func() {
			add(s, llm.Event{Kind: "notice", Content: fmt.Sprintf("%s exited %d", runner.Label(), code)})
		})
	}
	var outcomes []string
	var asks []Approval
	for _, ev := range s.Events[start:] {
		name, ok := runner.Tool(ev.Tool)
		if ev.Kind != "tool_use" || !ok {
			continue
		}
		level, err := ws.level(s.Agent, name)
		if err != nil {
			ws.fail(s, err)
			return ""
		}
		switch level {
		case "auto":
			outcomes = append(outcomes, ws.act(s, name, ev.Content))
		case "approval":
			asks = append(asks, Approval{ID: id(), Session: s.ID, Turn: s.Turns, Tool: name, ToolID: ev.ToolID, Input: ev.Content,
				State: "pending", At: time.Now()})
		default:
			outcomes = append(outcomes, name+": no such tool")
		}
	}
	switch {
	case len(asks) > 0:
		// The auto tools' outcomes wait with the session, to go with the decisions into one outcome turn.
		ws.put(s, func() {
			for _, a := range asks {
				ws.saveApproval(a)
			}
			s.State, s.Outcomes = "awaiting_approval", outcomes
		})
		return ""
	case code != 0 && transient(runner, s.Events[start:]) && retry(s.ID) <= retryLimit:
		// The agent could not reach its API (DNS, a reset, an overload): its session goes on after a pause, with what
		// the tools it did call came to.
		n, _ := retries.Load(s.ID)
		ws.put(s, func() {
			add(s, llm.Event{Kind: "notice", Content: fmt.Sprintf("%s could not reach its API; trying again (%d of %d).", runner.Label(), n, retryLimit)})
		})
		select {
		case <-time.After(time.Duration(n.(int)) * retryPause):
		case <-ctx.Done():
		}
		prompt := again
		if len(outcomes) > 0 {
			prompt = Outcome + "\n" + strings.Join(outcomes, "\n") + "\n\n" + again
		}
		ws.put(s, func() { s.Pending = prompt })
		return prompt
	case len(outcomes) > 0:
		retries.Delete(s.ID)
		prompt := Outcome + "\n" + strings.Join(outcomes, "\n")
		ws.put(s, func() { s.Pending = prompt })
		return prompt
	}
	retries.Delete(s.ID)
	return ws.drain(s)
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
func transient(runner llm.Runner, events []llm.Event) bool {
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
func (ws *Workspace) drain(s *Session) string {
	unlock := lock(s.ID)
	defer unlock()
	return ws.advance(s)
}

// drain, with the session's lock held. The intent is saved before the message leaves the queue, so a restart in
// between repeats it rather than loses it.
func (ws *Workspace) advance(s *Session) string {
	prompt, ok := ws.peek(s.ID)
	if !ok {
		s.State, s.Pending = "idle", ""
		ws.save(s)
		return ""
	}
	s.State, s.Pending = "running", prompt
	ws.save(s)
	ws.shift(s.ID)
	ws.announce(s)
	return prompt
}

// Runs the next queued message of a session at rest.
func (ws *Workspace) kick(sid string) {
	unlock := lock(sid)
	s, err := ws.load(sid)
	if err != nil || s.State != "idle" || ws.queued(sid) == 0 {
		unlock()
		return
	}
	prompt := ws.advance(&s)
	unlock()
	ws.run(context.Background(), &s, prompt)
}

// Appends events stamped with the time they arrived.
func add(s *Session, evs ...llm.Event) {
	now := time.Now()
	for _, ev := range evs {
		ev.At = now
		s.Events = append(s.Events, ev)
	}
}

// Stops the running turn: its process group is signalled, and the turn ends as stopped rather than failed. A tool
// being carried out for the session is cut short too.
func (ws *Workspace) Stop(ctx context.Context, sid string) error {
	s, err := ws.load(sid)
	if err != nil {
		return err
	}
	halted := ws.halt(ctx, sid)
	if s.State != "running" {
		if halted {
			return nil
		}
		return fmt.Errorf("session %s is %s", sid, s.State)
	}
	key := stopKey(sid, s.Turns)
	stops.Store(key, true)
	if err := ws.box(s.Actor).Cancel(ctx, fmt.Sprintf("turn-%d", s.Turns)); err != nil {
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
func (ws *Workspace) probe(ctx context.Context, actor string, port int, timeout time.Duration) (int, error) {
	c := &http.Client{Timeout: timeout, Transport: &http.Transport{DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return ws.Sandboxes.Dial(ctx, actor, box.Port)
		}}}
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost/favicon.ico", nil)
	if err := ws.Keyed(ctx, actor); err != nil {
		return 0, err
	}
	req.Header.Set(box.TokenHeader, ws.derive("actor", actor))
	req.Header.Set(box.ProxyHeader, strconv.Itoa(port))
	res, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	res.Body.Close()
	return res.StatusCode, nil
}

// Waits until the port answers HTTP with anything but a gateway error.
func (ws *Workspace) answers(ctx context.Context, actor string, port int) error {
	var last string
	for deadline := time.Now().Add(10 * time.Minute); time.Now().Before(deadline); time.Sleep(3 * time.Second) {
		code, err := ws.probe(ctx, actor, port, 30*time.Second)
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
func (ws *Workspace) PreviewStatus(ctx context.Context, sid string) (PreviewStatus, error) {
	s, err := ws.load(sid)
	if err != nil {
		return PreviewStatus{}, err
	}
	rt, err := ws.Route(s.Preview)
	if err != nil {
		return PreviewStatus{}, err
	}
	if err := ws.Workers.Ensure(ctx, rt.Actor, rt.Tier); err != nil {
		return PreviewStatus{Error: err.Error()}, nil
	}
	code, err := ws.probe(ctx, rt.Actor, rt.Port, 5*time.Second)
	if err != nil {
		return PreviewStatus{Error: err.Error()}, nil
	}
	return PreviewStatus{Status: code, Up: code < 500}, nil
}

// Frees the session's worker; the next preview request or turn resumes it where it was.
func (ws *Workspace) Suspend(ctx context.Context, sid string) error {
	s, err := ws.load(sid)
	if err != nil {
		return err
	}
	return ws.Sandboxes.Suspend(ctx, s.Actor)
}

// Removes the session: its sandbox, its preview's route and its queue; its pending approvals end stopped.
// Refused while it forks, runs, or carries out a decision.
func (ws *Workspace) DeleteSession(ctx context.Context, sid string) error {
	unlock := lock(sid)
	defer unlock()
	s, err := ws.load(sid)
	if err != nil {
		return err
	}
	if s.State == "forking" || s.State == "running" {
		return Conflict{fmt.Errorf("session %s is %s: stop it first", sid, s.State)}
	}
	open, err := ws.Approvals(sid, "pending", "deciding")
	if err != nil {
		return err
	}
	var pending []Approval
	deciding := ""
	for _, a := range open {
		if a.State == "deciding" {
			deciding = a.ID
		} else {
			pending = append(pending, a)
		}
	}
	if deciding != "" {
		return Conflict{fmt.Errorf("session %s is carrying out approval %s", sid, deciding)}
	}
	if err := ws.Sandboxes.Delete(ctx, s.Actor); err != nil {
		return fmt.Errorf("sandbox %s: %w", s.Actor, err)
	}
	for _, a := range pending {
		a.State = "stopped"
		if err := ws.saveApproval(a); err != nil {
			return err
		}
	}
	if err := ws.unroute(s.Preview); err != nil {
		return err
	}
	// Its row is kept, removed, with its events: its history is the workspace's.
	err = ws.DB.Transaction(func(tx *gorm.DB) error {
		r, err := rowOf(tx, sid)
		if err != nil {
			return err
		}
		if err := tx.Where("session_id = ?", r.ID).Delete(&db.QueuedMessage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&r).Error
	})
	if err != nil {
		return err
	}
	// A write left to the flush timer finds nothing due, so the row is not written back.
	writes.Store(sid, write{at: time.Now()})
	sent.Lock()
	delete(sent.n, sid)
	sent.Unlock()
	ws.Bus.Publish(Update{Kind: "reset"})
	return nil
}

// Every session without its events, the last active first; only env's when it is given.
func (ws *Workspace) Sessions(env string) ([]Summary, error) {
	all, err := ws.sessions(false, false)
	if err != nil {
		return nil, err
	}
	out := []Summary{}
	for _, s := range all {
		if env != "" && s.Env != env {
			continue
		}
		sum := s.Summary()
		if sum.Prompt, err = ws.firstPrompt(s.ID); err != nil {
			return nil, err
		}
		sum.Queued = ws.queued(s.ID)
		out = append(out, sum)
	}
	return out, nil
}
