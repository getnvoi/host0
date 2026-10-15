package main

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/workspace"
)

// Seconds each actor spent per state, and worker seconds per pool, sampled every UsageEvery into usage_hours. The
// rest of /usage is read from sessions and approvals as they are.
const dayFormat = "2006-01-02"

func (p *plane) usage(a huma.API) {
	huma.Register(a, op("usage", "GET", "/usage", "Sessions, compute, pull requests and tokens over the last days",
		hz{By: []string{"usage"}}),
		func(_ context.Context, in *struct {
			Days int    `query:"days" default:"30" minimum:"1" maximum:"365" doc:"How many days back, today's included"`
			By   string `query:"by" doc:"One person's usage: the sessions they started"`
		}) (*body[workspace.Usage], error) {
			return answer(p.Usage(time.Now(), in.Days, in.By))
		})
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

// One tick: every session's and seed's actor adds the tick to its state's seconds, every worker to its pool's.
func (p *plane) sample(ctx context.Context, now time.Time) {
	hour, step := now.UTC().Truncate(time.Hour), int64(p.every().Seconds())
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
	actors := map[string]db.UsageHour{}
	live, err := p.ws.Sessions("")
	if err != nil {
		log.Printf("usage: sessions: %v", err)
	}
	for _, s := range live {
		actors["wt-"+s.ID] = db.UsageHour{Session: s.ID, Env: s.Env, By: s.By}
	}
	seeds, err := p.ws.Seeds()
	if err != nil {
		log.Printf("usage: seeds: %v", err)
	}
	for _, s := range seeds {
		if s.Actor != "" {
			actors[s.Actor] = db.UsageHour{Session: "seed:" + s.Env, Env: s.Env}
		}
	}
	for actor, u := range actors {
		state, err := p.Sandboxes.State(ctx, actor)
		if err != nil {
			log.Printf("usage: state of %s: %v", actor, err)
			continue
		}
		switch state {
		case "running":
			u.RunningS = step
		case "paused":
			u.PausedS = step
		case "suspended":
			u.SuspendedS = step
		default:
			continue
		}
		u.Hour, u.Tier = hour, tier(u.Env)
		if err := p.addUsage(u); err != nil {
			log.Printf("usage %s: %v", u.Session, err)
		}
	}
	workers, err := p.Sandboxes.Workers(ctx)
	if err != nil {
		log.Printf("usage: workers: %v", err)
		return
	}
	for _, w := range workers {
		t, ok := strings.CutPrefix(w.Pool, "hz-")
		if !ok {
			t = w.Pool
		}
		if err := p.addUsage(db.UsageHour{Hour: hour, Tier: t, WorkerS: step}); err != nil {
			log.Printf("usage: worker %s: %v", w.Pod, err)
		}
	}
}

// Adds u's seconds to its hour's row, making the row first.
func (p *plane) addUsage(u db.UsageHour) error {
	add := map[string]any{}
	for _, col := range []string{"running_s", "paused_s", "suspended_s", "worker_s"} {
		add[col] = gorm.Expr("usage_hours." + col + " + excluded." + col)
	}
	return p.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "hour"}, {Name: "tier"}, {Name: "session"}},
		DoUpdates: clause.Assignments(add)}).Create(&u).Error
}

// The days up to now's (UTC) for everyone, or for the sessions by started.
func (p *plane) Usage(now time.Time, days int, by string) (workspace.Usage, error) {
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
					if strings.HasPrefix(line, `session_pr: {"url":`) {
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

	var hours []db.UsageHour
	if err := p.DB.Where("hour >= ? AND hour < ?", from, to.AddDate(0, 0, 1)).Find(&hours).Error; err != nil {
		return out, err
	}
	for _, u := range hours {
		day := at(u.Hour)
		switch {
		case day == nil:
		case u.Session == "":
			if by == "" {
				day.Nodes += minutes(u.WorkerS)
			}
		case by == "" || u.By == by && !strings.HasPrefix(u.Session, "seed:"):
			running := minutes(u.RunningS)
			day.Compute[u.Env] += running
			day.States["running"] += running
			day.States["paused"] += minutes(u.PausedS)
			day.States["suspended"] += minutes(u.SuspendedS)
			out.Totals.Compute += running
			env(u.Env).Compute += running
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

func minutes(s int64) float64 { return float64(s) / 60 }

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
