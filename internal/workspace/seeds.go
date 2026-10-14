package workspace

import (
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
)

// A seed row is one build: the latest of an environment is the one under way or the last to end; the latest ready
// one is the seed sessions fork from.

func seedOf(r db.Seed, env string) Seed {
	s := Seed{ID: r.ID, Env: env, Run: r.Run, Actor: r.Actor, Template: r.Template, Tag: r.Tag, State: r.State, Step: r.Step,
		Error: r.Error, Preview: r.Preview, Spec: r.Spec, At: r.StartedAt}
	return s
}

// The environment's latest seed with the condition given; NotFound when it has none.
func (ws *Workspace) latestSeed(name, where string, args ...any) (Seed, error) {
	env, err := environmentRow(ws.DB, name)
	if err != nil {
		return Seed{}, err
	}
	var r db.Seed
	q := ws.DB.Where("environment_id = ?", env.ID)
	if where != "" {
		q = q.Where(where, args...)
	}
	err = q.Order("id DESC").First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Seed{}, NotFound{fmt.Errorf("environment %s has no seed: hz env seed %s builds one", name, name)}
	}
	return seedOf(r, name), err
}

// The environment's seed build: the one under way, or the last to end.
func (ws *Workspace) SeedOf(name string) (Seed, error) { return ws.latestSeed(name, "") }

// Writes s: a new build's row when it has none yet.
func (ws *Workspace) putSeed(s *Seed) error {
	env, err := environmentRow(ws.DB, s.Env)
	if err != nil {
		return err
	}
	r := db.Seed{ID: s.ID, EnvironmentID: env.ID, Run: s.Run, Actor: s.Actor, Template: s.Template, Tag: s.Tag, Spec: s.Spec,
		State: s.State, Step: s.Step, Error: s.Error, Preview: s.Preview, StartedAt: s.At}
	if s.State == "ready" {
		at := s.At
		r.BuiltAt = &at
	}
	if err := ws.DB.Save(&r).Error; err != nil {
		return err
	}
	s.ID = r.ID
	return nil
}

// The latest seed of every environment, and every ready one an environment still forks from.
func (ws *Workspace) Seeds() ([]Seed, error) {
	var rows []struct {
		db.Seed
		Env string
	}
	err := ws.DB.Table("seeds").Select("seeds.*, environments.name AS env").
		Joins("JOIN environments ON environments.id = seeds.environment_id").
		Where(`seeds.id IN (SELECT max(id) FROM seeds GROUP BY environment_id)
			OR seeds.id IN (SELECT max(id) FROM seeds WHERE state = 'ready' GROUP BY environment_id)`).
		Order("seeds.id").Scan(&rows).Error
	out := make([]Seed, len(rows))
	for i, r := range rows {
		out[i] = seedOf(r.Seed, r.Env)
	}
	return out, err
}

// Removes the environment's seed rows older than keep: their actors are gone.
func (ws *Workspace) pruneSeeds(name string, keep uint) error {
	env, err := environmentRow(ws.DB, name)
	if err != nil {
		return err
	}
	return ws.DB.Where("environment_id = ? AND id < ?", env.ID, keep).Delete(&db.Seed{}).Error
}
