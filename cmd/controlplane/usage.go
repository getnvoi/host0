package main

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/workspace"
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

func (p *plane) every() time.Duration {
	if p.UsageEvery > 0 {
		return p.UsageEvery
	}
	return time.Minute
}

func (p *plane) Sample(ctx context.Context) {
	for now := range time.Tick(p.every()) {
		p.sample(ctx, now)
	}
}

// One tick: every session's and seed's actor adds the tick to its state's minutes, every worker to its pool's.
func (p *plane) sample(ctx context.Context, now time.Time) {
	day, step := now.UTC().Format(dayFormat), p.every().Minutes()
	tierOf := map[string]string{}
	tier := func(env string) string {
		if t, ok := tierOf[env]; ok {
			return t
		}
		if e, err := p.ws.Environment(env); err == nil {
			if t, err := p.sc.Tier(e.Tier); err == nil {
				tierOf[env] = t.Name
			}
		}
		return tierOf[env]
	}
	actors := map[string]usage{}
	live, err := p.ws.Sessions("")
	if err != nil {
		log.Printf("usage: sessions: %v", err)
	}
	for _, s := range live {
		actors["wt-"+s.ID] = usage{Session: s.ID, Env: s.Env, By: s.By}
	}
	seeds, err := p.ws.Seeds()
	if err != nil {
		log.Printf("usage: seeds: %v", err)
	}
	for _, s := range seeds {
		if s.Actor != "" {
			actors[s.Actor] = usage{Session: "seed:" + s.Env, Env: s.Env}
		}
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
func (p *plane) Usage(now time.Time, days int, by string) (workspace.Usage, error) {
	if days <= 0 {
		days = 30
	}
	days = min(days, 365)
	to := now.UTC().Truncate(24 * time.Hour)
	from := to.AddDate(0, 0, -(days - 1))
	out := workspace.Usage{From: from.Format(dayFormat), To: to.Format(dayFormat), People: []string{},
		Days: make([]workspace.UsageDay, days), Environments: []workspace.UsageEnv{}}
	index := map[string]int{}
	for i := range out.Days {
		d := from.AddDate(0, 0, i).Format(dayFormat)
		index[d] = i
		out.Days[i] = workspace.UsageDay{Day: d, Compute: map[string]float64{},
			States: map[string]float64{"running": 0, "paused": 0, "suspended": 0}}
	}
	at := func(t time.Time) *workspace.UsageDay {
		if i, ok := index[t.UTC().Format(dayFormat)]; ok {
			return &out.Days[i]
		}
		return nil
	}
	envs := map[string]*workspace.UsageEnv{}
	env := func(name string) *workspace.UsageEnv {
		if envs[name] == nil {
			envs[name] = &workspace.UsageEnv{Name: name}
		}
		return envs[name]
	}
	people := map[string]bool{}

	scope := map[string]bool{}
	history, err := p.ws.History()
	if err != nil {
		return out, err
	}
	for _, s := range history {
		if s.By != "" {
			people[s.By] = true
		}
		if by != "" && s.By != by {
			continue
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
			case e.Kind == "prompt" && strings.HasPrefix(e.Content, workspace.Outcome):
				for _, line := range strings.Split(e.Content, "\n") {
					if strings.HasPrefix(line, "create_pull_request: opened") {
						day.PullRequests++
						out.Totals.PullRequests++
						env(s.Env).PullRequests++
					}
				}
			}
		}
	}
	labels, err := p.auth.People()
	if err != nil {
		return out, err
	}
	for _, l := range labels {
		people[l] = true
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
	approvals, err := p.ws.Approvals("")
	if err != nil {
		return out, err
	}
	for _, a := range approvals {
		if !scope[a.Session] || a.Decided.IsZero() || at(a.Decided) == nil {
			continue
		}
		out.Totals.Approvals++
		if !a.At.IsZero() {
			waits = append(waits, a.Decided.Sub(a.At).Milliseconds())
		}
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
