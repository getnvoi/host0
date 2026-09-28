package controlplane

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/getnvoi/host0/controlplane/box"
	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

const (
	App     = "/workspace/app"
	Home    = "/workspace/.hz/home"
	Boxd    = "/workspace/.hz/bin/boxd"
	Ready   = "/workspace/.hz/ready"
	Runs    = "/workspace/.hz/runs"
	pathEnv = Home + "/.local/bin:/usr/local/bundle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
)

type Plane struct {
	Sandboxes Sandboxes
	Pools     Pools
	// Idle this long, an actor is paused; this long, suspended and its worker freed.
	PauseAfter, SuspendAfter time.Duration
	Store                    Store
	Edge                     Edge
	Forge                    Forge
	Pin                      func(ctx context.Context, image string) (string, error)
	BoxImage                 string
	BoxToken                 string
	Cluster                  string
	Zone                     string
	Suffix                   string

	// How often usage is sampled; a minute when zero.
	UsageEvery time.Duration
}

// One label under the zone, which its universal certificate covers: api-dev.nvoi.to, 4ca708e1-dev-preview.nvoi.to.
func (p *Plane) Host(name string) string { return fmt.Sprintf("%s-%s.%s", name, p.Cluster, p.Zone) }
func (p *Plane) Preview(name string) string {
	return fmt.Sprintf("%s-%s%s.%s", name, p.Cluster, p.Suffix, p.Zone)
}

// A secret derived from BoxToken, which never enters a sandbox. A sandbox's boxd starts with its environment's token
// (every fork of a seed holds the same) and is switched to its own on first contact.
func (p *Plane) derive(kind, name string) string {
	mac := hmac.New(sha256.New, []byte(p.BoxToken))
	mac.Write([]byte(kind + "\x00" + name))
	return hex.EncodeToString(mac.Sum(nil))
}

func (p *Plane) box(actor string) box.Client {
	return box.Client{Token: p.derive("actor", actor), Seed: p.derive("env", p.envOf(actor)),
		Dial: func(ctx context.Context) (net.Conn, error) { return p.Sandboxes.Dial(ctx, actor, box.Port) }}
}

// When each actor's boxd was last seen to take its own token.
var keyedAt sync.Map

// Before a request goes to the actor's boxd raw (a preview, a terminal), makes sure boxd has its own token: it
// is checked again after a minute, since a boxd that restarted is back on its environment's.
func (p *Plane) keyed(ctx context.Context, actor string) error {
	if at, ok := keyedAt.Load(actor); ok && time.Since(at.(time.Time)) < time.Minute {
		return nil
	}
	if err := p.box(actor).Check(ctx); err != nil {
		return err
	}
	keyedAt.Store(actor, time.Now())
	return nil
}

var envs sync.Map

// The environment an actor was made from: a session's, or the one a seed is built for.
func (p *Plane) envOf(actor string) string {
	if v, ok := envs.Load(actor); ok {
		return v.(string)
	}
	var env string
	if sid, ok := strings.CutPrefix(actor, "wt-"); ok {
		var s contract.Session
		if p.Store.Get("sessions", sid, &s) == nil {
			env = s.Env
		}
	} else {
		for _, kind := range []string{"seeds", "ready"} {
			p.Store.List(kind, func(d func(any) error) error {
				var seed contract.Seed
				if d(&seed) == nil && seed.Actor == actor {
					env = seed.Env
				}
				return nil
			})
		}
	}
	if env != "" {
		envs.Store(actor, env)
	}
	return env
}

func sh(script string) []string { return []string{"sh", "-c", script} }

// The actor's containers: boxd's carrier, the agent running boxd on the environment's image, and the services.
func (p *Plane) containers(ctx context.Context, env contract.Environment) ([]Container, error) {
	base := map[string]string{"HOME": Home}
	for k, v := range env.Env {
		base[k] = v
	}
	for k, v := range env.Secrets {
		base[k] = v
	}
	image, err := p.Pin(ctx, env.Image)
	if err != nil {
		return nil, err
	}
	withPath := func(m map[string]string) map[string]string {
		out := map[string]string{"PATH": pathEnv}
		for k, v := range m {
			out[k] = v
		}
		return out
	}
	cs := []Container{
		{Name: "boxd", Image: p.BoxImage, Command: []string{"/ko-app/boxd", "install", Boxd}},
		{Name: "agent", Image: image, Env: withPath(with(base, "HZ_BOX_TOKEN", p.derive("env", env.Name))), Probe: box.Port,
			// boxd comes back when it dies: its runs' logs are on /workspace, and it settles the ones it lost.
			Command: sh(fmt.Sprintf("until [ -x %s ]; do sleep 0.2; done; while :; do %s; sleep 1; done", Boxd, Boxd))},
	}
	for _, s := range env.Services {
		img, env := image, withPath(base)
		if s.Image != "" {
			if img, err = p.Pin(ctx, s.Image); err != nil {
				return nil, err
			}
			env = map[string]string{}
			for k, v := range base {
				env[k] = v
			}
		}
		for k, v := range s.Env {
			env[k] = v
		}
		cmd := s.Command
		if !s.Early {
			// Waits for the checkout, and comes back up when it exits: a restart is touching nothing but the process.
			cmd = fmt.Sprintf("until [ -f %s ]; do sleep 1; done; cd %s; while :; do %s; sleep 1; done", Ready, App, s.Command)
		}
		cmd = fmt.Sprintf("mkdir -p %s; { %s; } 2>&1 | tee -a %s/%s.log", Logs, cmd, Logs, s.Name)
		cs = append(cs, Container{Name: s.Name, Image: img, Command: sh(cmd), Env: env})
	}
	return cs, nil
}

// Clone, install the agent CLI, run the environment's setup; the services start once it is done.
func seedScript(env contract.Environment) string {
	var b strings.Builder
	fmt.Fprintf(&b, "set -e\nmkdir -p %s\n", Home)
	fmt.Fprintf(&b, "git config --global user.name hz && git config --global user.email agent@nvoi.to\n")
	fmt.Fprintf(&b, "git config --global --add safe.directory '*'\n")
	fmt.Fprintf(&b, "[ -d %s/.git ] || git clone -q --branch %s \"https://x-access-token:$GITHUB_TOKEN@github.com/%s\" %s\n", App, env.Branch, env.Repo, App)
	fmt.Fprintf(&b, "git -C %s remote set-url origin https://github.com/%s\n", App, env.Repo)
	// A rebuild starts from the branch as it is now, not the checkout the last build left.
	fmt.Fprintf(&b, "git -C %s fetch -q \"https://x-access-token:$GITHUB_TOKEN@github.com/%s\" %s && git -C %s reset -q --hard FETCH_HEAD\n",
		App, env.Repo, env.Branch, App)
	// Every runner, so a credential moved to another provider finds its CLI in the seed.
	for _, r := range Runners {
		b.WriteString(r.Install() + "\n")
	}
	fmt.Fprintf(&b, "cd %s\n", App)
	for _, s := range env.Setup {
		b.WriteString(s + "\n")
	}
	fmt.Fprintf(&b, "touch %s\n", Ready)
	return b.String()
}

func (p *Plane) env(name string) (contract.Environment, contract.Credentials, error) {
	var env contract.Environment
	var creds contract.Credentials
	if err := p.Store.Get("environments", name, &env); err != nil {
		return env, creds, fmt.Errorf("environment %s: %w", name, err)
	}
	err := p.Store.Get("credentials", "default", &creds)
	return env, creds, err
}

// Rebuilds, in the background, the seeds built from other containers (another boxd, another command): a fork keeps
// its seed's containers, running.
func (p *Plane) Refresh() {
	var envs []contract.Environment
	p.Store.List("environments", func(d func(any) error) error {
		var env contract.Environment
		if d(&env) == nil {
			envs = append(envs, env)
		}
		return nil
	})
	for _, env := range envs {
		seed, err := p.served(env.Name)
		if err != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		cs, err := p.containers(ctx, env)
		cancel()
		if err != nil {
			log.Printf("reseed %s: %v", env.Name, err)
			continue
		}
		if seed.Spec != spec(cs) {
			log.Printf("reseed %s: built from other containers", env.Name)
			p.Reseed(env.Name)
		}
	}
}

// A digest of the containers a seed is built from.
func spec(cs []Container) string {
	b, _ := json.Marshal(cs)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

// Environments with a seed being built; one build at a time each.
var seeding sync.Map

// Starts building the environment's seed in the background; a conflict when one is already being built.
func (p *Plane) Reseed(name string) error {
	if _, busy := seeding.LoadOrStore(name, true); busy {
		return conflict{fmt.Errorf("the seed of %s is already being built", name)}
	}
	go func() {
		defer seeding.Delete(name)
		p.Seed(context.Background(), name)
	}()
	return nil
}

// The seed sessions fork from: the last one built ready, which a build in progress leaves in place.
func (p *Plane) served(name string) (contract.Seed, error) {
	var seed contract.Seed
	if p.Store.Get("ready", name, &seed) == nil {
		return seed, nil
	}
	if p.Store.Get("seeds", name, &seed) == nil && seed.State == "ready" {
		return seed, nil
	}
	return seed, fmt.Errorf("environment %s has no ready seed", name)
}

// Builds the seed. "seeds" holds the build as it goes; "ready" the last one that finished, for sessions to fork.
func (p *Plane) Seed(ctx context.Context, name string) error {
	seed := contract.Seed{Env: name, State: "building", At: time.Now()}
	fail := func(err error) error {
		seed.State, seed.Error = "failed", err.Error()
		p.Store.Put("seeds", name, seed)
		log.Printf("seed %s: %v", name, err)
		return err
	}
	env, creds, err := p.env(name)
	if err != nil {
		return fail(err)
	}
	p.Store.Put("seeds", name, seed)
	cs, err := p.containers(ctx, env)
	if err != nil {
		return fail(err)
	}
	seed.Spec = spec(cs)
	tier, err := tiers.Get(env.Tier)
	if err != nil {
		return fail(err)
	}
	if seed.Template, err = p.Sandboxes.Template(ctx, env.Name, tier, cs); err != nil {
		return fail(err)
	}
	// One tag per build: a tag that exists is not moved, so a rebuild under the same name would leave forks on the old.
	seed.Actor, seed.Tag = seed.Template, seed.Template+"-"+id()
	p.Store.Put("seeds", name, seed)
	// A build that crashed leaves its actor crashed, and a crashed actor never resumes: this build starts over.
	if state, err := p.Sandboxes.State(ctx, seed.Actor); err == nil && state == "crashed" {
		if err := p.Sandboxes.Delete(ctx, seed.Actor); err != nil {
			return fail(err)
		}
	}
	if err := p.Sandboxes.Create(ctx, seed.Actor, seed.Template, ""); err != nil {
		return fail(err)
	}
	// Held busy while it builds, so the scaler does not pause it midway.
	release, err := p.enter(ctx, seed.Actor, tier.Name)
	if err != nil {
		return fail(err)
	}
	defer release()
	bx := p.box(seed.Actor)
	if err := bx.Ready(ctx); err != nil {
		return fail(err)
	}
	seed.Run = "seed-" + id()
	p.Store.Put("seeds", name, seed)
	run := box.Run{Argv: sh(seedScript(env)), Dir: "/workspace", Env: map[string]string{"GITHUB_TOKEN": creds.GitHub}}
	if err := bx.Must(ctx, seed.Run, run, func(l string) { log.Printf("seed %s | %s", name, l) }); err != nil {
		return fail(err)
	}
	if err := p.answers(ctx, seed.Actor, env.Preview); err != nil {
		return fail(err)
	}
	// Forks start from this boxd as it runs: it goes back to the environment's token, which each fork then trades
	// for its own.
	back := box.Client{Token: p.derive("env", name), Seed: p.derive("actor", seed.Actor), Dial: bx.Dial}
	if err := back.Rekey(ctx); err != nil {
		return fail(err)
	}
	if err := p.Sandboxes.Suspend(ctx, seed.Actor); err != nil {
		return fail(err)
	}
	if err := p.Sandboxes.Tag(ctx, seed.Tag, seed.Actor); err != nil {
		return fail(err)
	}
	seed.Preview = p.Preview(name)
	if err := p.route(ctx, seed.Preview, Route{seed.Actor, env.Preview, tier.Name}); err != nil {
		return fail(err)
	}
	seed.State = "ready"
	if err := p.Store.Put("ready", name, seed); err != nil {
		return fail(err)
	}
	return p.Store.Put("seeds", name, seed)
}

type Route struct {
	Actor string `json:"actor"`
	Port  int    `json:"port"`
	Tier  string `json:"tier"`
}

func (p *Plane) route(ctx context.Context, host string, rt Route) error {
	if err := p.Store.Put("routes", host, rt); err != nil {
		return err
	}
	return p.Edge.Route(ctx, host)
}

func id() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func with(m map[string]string, k, v string) map[string]string {
	out := map[string]string{k: v}
	for mk, mv := range m {
		out[mk] = mv
	}
	return out
}

// How a browser reaches a host: through the cluster's tunnel, over https, on a cloud cluster as on this machine.
func origin(host string) string { return "https://" + host }

func Origin(host string) string { return origin(host) }
