package controlplane

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

// Minutes each actor spent per state per day, and worker minutes per pool, sampled every UsageEvery. The rest of
// /usage is read from sessions and approvals as they are.
const dayFormat = "2006-01-02"

type usage struct {
	Day       string  `json:"day"`
	Session   string  `json:"session"` // seed:<env> for a seed
	Env       string  `json:"env"`
	Tier      string  `json:"tier"`
	By        string  `json:"by"`
	Running   float64 `json:"running"`
	Paused    float64 `json:"paused"`
	Suspended float64 `json:"suspended"`
}

type nodes struct {
	Day     string             `json:"day"`
	Minutes map[string]float64 `json:"minutes"` // pool to worker minutes
}

func (p *Plane) every() time.Duration {
	if p.UsageEvery > 0 {
		return p.UsageEvery
	}
	return time.Minute
}

func (p *Plane) Sample(ctx context.Context) {
	for now := range time.Tick(p.every()) {
		p.sample(ctx, now)
	}
}

// One tick: every session's and seed's actor adds the tick to its state's minutes, every worker to its pool's.
func (p *Plane) sample(ctx context.Context, now time.Time) {
	day, step := now.UTC().Format(dayFormat), p.every().Minutes()
	tierOf := map[string]string{}
	tier := func(env string) string {
		if t, ok := tierOf[env]; ok {
			return t
		}
		var e contract.Environment
		if p.Store.Get("environments", env, &e) == nil {
			if t, err := tiers.Get(e.Tier); err == nil {
				tierOf[env] = t.Name
			}
		}
		return tierOf[env]
	}
	actors := map[string]usage{}
	if err := p.Store.List("sessions", func(d func(any) error) error {
		var s struct{ ID, Env, Actor, By string }
		if d(&s) == nil && s.Actor != "" {
			actors[s.Actor] = usage{Session: s.ID, Env: s.Env, By: s.By}
		}
		return nil
	}); err != nil {
		log.Printf("usage: sessions: %v", err)
	}
	if err := p.Store.List("seeds", func(d func(any) error) error {
		var s contract.Seed
		if d(&s) == nil && s.Actor != "" {
			actors[s.Actor] = usage{Session: "seed:" + s.Env, Env: s.Env}
		}
		return nil
	}); err != nil {
		log.Printf("usage: seeds: %v", err)
	}
	for actor, base := range actors {
		state, err := p.Sandboxes.State(ctx, actor)
		if err != nil {
			continue
		}
		key := day + "/" + base.Session
		var u usage
		if p.Store.Get("usage", key, &u) != nil {
			u = base
			u.Day, u.Tier = day, tier(base.Env)
		}
		switch state {
		case "running":
			u.Running += step
		case "paused":
			u.Paused += step
		case "suspended":
			u.Suspended += step
		default:
			continue
		}
		if err := p.Store.Put("usage", key, u); err != nil {
			log.Printf("usage %s: %v", key, err)
		}
	}
	workers, err := p.Sandboxes.Workers(ctx)
	if err != nil {
		log.Printf("usage: workers: %v", err)
		return
	}
	if len(workers) == 0 {
		return
	}
	n := nodes{Day: day, Minutes: map[string]float64{}}
	p.Store.Get("nodes", day, &n)
	for _, w := range workers {
		pool := w.Pool
		if pool == "" {
			pool = "worker"
		}
		n.Minutes[pool] += step
	}
	if err := p.Store.Put("nodes", day, n); err != nil {
		log.Printf("usage: nodes %s: %v", day, err)
	}
}

// The days up to now's (UTC) for everyone, or for the sessions by started.
func (p *Plane) Usage(now time.Time, days int, by string) (contract.Usage, error) {
	if days <= 0 {
		days = 30
	}
	days = min(days, 365)
	to := now.UTC().Truncate(24 * time.Hour)
	from := to.AddDate(0, 0, -(days - 1))
	out := contract.Usage{From: from.Format(dayFormat), To: to.Format(dayFormat), People: []string{},
		Days: make([]contract.UsageDay, days), Environments: []contract.UsageEnv{}}
	index := map[string]int{}
	for i := range out.Days {
		d := from.AddDate(0, 0, i).Format(dayFormat)
		index[d] = i
		out.Days[i] = contract.UsageDay{Day: d, Compute: map[string]float64{},
			States: map[string]float64{"running": 0, "paused": 0, "suspended": 0}}
	}
	at := func(t time.Time) *contract.UsageDay {
		if i, ok := index[t.UTC().Format(dayFormat)]; ok {
			return &out.Days[i]
		}
		return nil
	}
	envs := map[string]*contract.UsageEnv{}
	env := func(name string) *contract.UsageEnv {
		if envs[name] == nil {
			envs[name] = &contract.UsageEnv{Name: name}
		}
		return envs[name]
	}
	people := map[string]bool{}

	scope := map[string]bool{}
	err := p.Store.List("sessions", func(d func(any) error) error {
		var s contract.Session
		if err := d(&s); err != nil {
			return err
		}
		if s.By != "" {
			people[s.By] = true
		}
		if by != "" && s.By != by {
			return nil
		}
		scope[s.ID] = true
		if day := at(s.At); day != nil {
			day.Sessions++
			out.Totals.Sessions++
			env(s.Env).Sessions++
		}
		for _, e := range s.Events {
			day := at(e.At)
			if day == nil {
				continue
			}
			switch {
			case e.Kind == "result" || e.Kind == "error":
				var m struct{ Tokens int64 }
				json.Unmarshal(e.Meta, &m)
				day.Tokens += m.Tokens
				out.Totals.Tokens += m.Tokens
				env(s.Env).Tokens += m.Tokens
			case e.Kind == "prompt" && strings.HasPrefix(e.Content, outcome):
				for _, line := range strings.Split(e.Content, "\n") {
					if strings.HasPrefix(line, "create_pull_request: opened") {
						day.PullRequests++
						out.Totals.PullRequests++
						env(s.Env).PullRequests++
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	if err := p.Store.List("browsers", func(d func(any) error) error {
		var b browser
		if d(&b) == nil && b.Label != "" {
			people[b.Label] = true
		}
		return nil
	}); err != nil {
		return out, err
	}
	for name := range people {
		out.People = append(out.People, name)
	}
	sort.Strings(out.People)

	if err := p.Store.List("usage", func(d func(any) error) error {
		var u usage
		if err := d(&u); err != nil {
			return err
		}
		i, ok := index[u.Day]
		if !ok || by != "" && (u.By != by || strings.HasPrefix(u.Session, "seed:")) {
			return nil
		}
		day := &out.Days[i]
		day.Compute[u.Env] += u.Running
		day.States["running"] += u.Running
		day.States["paused"] += u.Paused
		day.States["suspended"] += u.Suspended
		out.Totals.Compute += u.Running
		env(u.Env).Compute += u.Running
		return nil
	}); err != nil {
		return out, err
	}
	if by == "" {
		if err := p.Store.List("nodes", func(d func(any) error) error {
			var n nodes
			if err := d(&n); err != nil {
				return err
			}
			if i, ok := index[n.Day]; ok {
				for _, m := range n.Minutes {
					out.Days[i].Nodes += m
				}
			}
			return nil
		}); err != nil {
			return out, err
		}
	}

	var waits []int64
	if err := p.Store.List("approvals", func(d func(any) error) error {
		var a contract.Approval
		if err := d(&a); err != nil {
			return err
		}
		if !scope[a.Session] || a.Decided.IsZero() || at(a.Decided) == nil {
			return nil
		}
		out.Totals.Approvals++
		if !a.At.IsZero() {
			waits = append(waits, a.Decided.Sub(a.At).Milliseconds())
		}
		return nil
	}); err != nil {
		return out, err
	}
	out.Totals.ApprovalWaitMS = median(waits)

	for _, e := range envs {
		out.Environments = append(out.Environments, *e)
	}
	sort.Slice(out.Environments, func(i, j int) bool {
		a, b := out.Environments[i], out.Environments[j]
		if a.Compute != b.Compute {
			return a.Compute > b.Compute
		}
		return a.Name < b.Name
	})
	return out, nil
}

func median(v []int64) int64 {
	if len(v) == 0 {
		return 0
	}
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	if n := len(v); n%2 == 0 {
		return (v[n/2-1] + v[n/2]) / 2
	}
	return v[len(v)/2]
}
