package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
)

// Held across each read and write of an environment's rows, so two patches do not lose one another.
var environments sync.Mutex

// The environment with its secrets' values left out.
func (ws *Workspace) Environment(name string) (Environment, error) {
	e, err := ws.environment(ws.DB, name)
	if err != nil {
		return e, err
	}
	return redacted(e), nil
}

// The live environment's row; NotFound when there is none.
func environmentRow(tx *gorm.DB, name string) (db.Environment, error) {
	var row db.Environment
	err := tx.Where("name = ? AND archived_at IS NULL", name).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, NotFound{fmt.Errorf("no environment %s", name)}
	}
	return row, err
}

// The environment from its rows, secrets' values included.
func (ws *Workspace) environment(tx *gorm.DB, name string) (Environment, error) {
	row, err := environmentRow(tx, name)
	if err != nil {
		return Environment{}, err
	}
	byPosition := func(q *gorm.DB) *gorm.DB { return q.Order("position") }
	byID := func(q *gorm.DB) *gorm.DB { return q.Order("id") }
	if err := tx.Preload("EnvVars").Preload("Secrets").Preload("SetupSteps", byPosition).Preload("Services", byID).
		First(&row, row.ID).Error; err != nil {
		return Environment{}, err
	}
	e := Environment{Name: row.Name, Repo: row.Repo, Branch: row.Branch, Image: row.Image, Preview: row.Preview,
		Tier: row.Tier}
	for _, v := range row.EnvVars {
		if e.Env == nil {
			e.Env = map[string]string{}
		}
		e.Env[v.Key] = v.Value
	}
	for _, s := range row.Secrets {
		if e.Secrets == nil {
			e.Secrets = map[string]string{}
		}
		e.Secrets[s.Key] = s.Value
	}
	for _, s := range row.SetupSteps {
		e.Setup = append(e.Setup, s.Command)
	}
	for _, s := range row.Services {
		e.Services = append(e.Services, Service{Name: s.Name, Image: s.Image, Command: s.Command, Port: s.Port,
			Env: s.Env, Early: s.Early})
	}
	return e, nil
}

func redacted(e Environment) Environment {
	if len(e.Secrets) > 0 {
		names := map[string]string{}
		for k := range e.Secrets {
			names[k] = ""
		}
		e.Secrets = names
	}
	return e
}

// Replaces the environment. A secret with an empty value keeps the one stored under its name.
func (ws *Workspace) PutEnvironment(in EnvironmentInput) error {
	environments.Lock()
	defer environments.Unlock()
	e := Environment(in)
	old, err := ws.environment(ws.DB, e.Name)
	if err != nil && !errors.As(err, new(NotFound)) {
		return err
	}
	return ws.store(e, old)
}

// Applies a JSON merge patch (RFC 7386): null removes a key, an object merges, anything else replaces.
func (ws *Workspace) PatchEnvironment(name string, patch []byte) (Environment, error) {
	environments.Lock()
	defer environments.Unlock()
	old, err := ws.environment(ws.DB, name)
	if err != nil {
		return old, err
	}
	var ch map[string]any
	if err := json.Unmarshal(patch, &ch); err != nil {
		return old, Invalid{fmt.Errorf("a patch is a JSON object: %w", err)}
	}
	known := fields(reflect.TypeOf(old))
	for k, v := range ch {
		if !known[k] {
			return old, Invalid{fmt.Errorf("unknown field %q", k)}
		}
		if k == "name" && v != name {
			return old, Invalid{fmt.Errorf("the name of %s does not change", name)}
		}
	}
	var doc map[string]any
	b, err := json.Marshal(old)
	if err != nil {
		return old, err
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return old, err
	}
	b, err = json.Marshal(merge(doc, ch))
	if err != nil {
		return old, err
	}
	var e Environment
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(&e); err != nil {
		return old, Invalid{err}
	}
	e.Name = name
	if err := ws.store(e, old); err != nil {
		return old, err
	}
	return redacted(e), nil
}

func merge(doc, patch map[string]any) map[string]any {
	for k, v := range patch {
		switch v := v.(type) {
		case nil:
			delete(doc, k)
		case map[string]any:
			cur, _ := doc[k].(map[string]any)
			if cur == nil {
				cur = map[string]any{}
			}
			doc[k] = merge(cur, v)
		default:
			doc[k] = v
		}
	}
	return doc
}

// The JSON names of t's fields.
func fields(t reflect.Type) map[string]bool {
	out := map[string]bool{}
	for i := 0; i < t.NumField(); i++ {
		name, _, _ := strings.Cut(t.Field(i).Tag.Get("json"), ",")
		out[name] = true
	}
	return out
}

// Writes e over old, under environments, once valid: its row, and its variables, secrets, steps and services anew.
func (ws *Workspace) store(e, old Environment) error {
	for k, v := range e.Secrets {
		if v != "" {
			continue
		}
		if old.Secrets[k] == "" {
			return Invalid{fmt.Errorf("secret %s has no value", k)}
		}
		e.Secrets[k] = old.Secrets[k]
	}
	if err := ws.valid(e); err != nil {
		return Invalid{err}
	}
	return ws.remasked(ws.DB.Transaction(func(tx *gorm.DB) error {
		// An archived row under the name comes back: its sessions' history is the environment's again.
		var row db.Environment
		if err := tx.Where("name = ?", e.Name).First(&row).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		row.Name, row.Repo, row.Branch, row.Image, row.Preview, row.Tier = e.Name, e.Repo, e.Branch, e.Image, e.Preview, e.Tier
		row.ArchivedAt = nil
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		for _, m := range []any{&db.EnvVar{}, &db.Secret{}, &db.SetupStep{}, &db.Service{}} {
			if err := tx.Where("environment_id = ?", row.ID).Delete(m).Error; err != nil {
				return err
			}
		}
		var rows []any
		for _, k := range keys(e.Env) {
			rows = append(rows, &db.EnvVar{EnvironmentID: row.ID, Key: k, Value: e.Env[k]})
		}
		for _, k := range keys(e.Secrets) {
			rows = append(rows, &db.Secret{EnvironmentID: row.ID, Key: k, Value: e.Secrets[k]})
		}
		for i, c := range e.Setup {
			rows = append(rows, &db.SetupStep{EnvironmentID: row.ID, Position: i, Command: c})
		}
		for _, s := range e.Services {
			rows = append(rows, &db.Service{EnvironmentID: row.ID, Name: s.Name, Image: s.Image, Command: s.Command,
				Port: s.Port, Early: s.Early, Env: s.Env})
		}
		for _, r := range rows {
			if err := tx.Create(r).Error; err != nil {
				return err
			}
		}
		return nil
	}))
}

func (ws *Workspace) valid(e Environment) error {
	if e.Name == "" {
		return fmt.Errorf("an environment needs a name")
	}
	if _, err := ws.Workers.Tier(e.Tier); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, s := range e.Services {
		if s.Name == "" {
			return fmt.Errorf("a service needs a name")
		}
		if seen[s.Name] {
			return fmt.Errorf("service %s is declared twice", s.Name)
		}
		seen[s.Name] = true
	}
	return nil
}

// Removes the environment, its seed's sandboxes and its preview's route. Refused while a session or a build uses it.
func (ws *Workspace) DeleteEnvironment(ctx context.Context, name string) error {
	environments.Lock()
	defer environments.Unlock()
	row, err := environmentRow(ws.DB, name)
	if err != nil {
		return err
	}
	if _, busy := seeding.LoadOrStore(name, true); busy {
		return Conflict{fmt.Errorf("the seed of %s is being built", name)}
	}
	defer seeding.Delete(name)
	var users []string
	if err := ws.DB.Model(&db.Session{}).Where("environment_id = ?", row.ID).Order("public_id").
		Pluck("public_id", &users).Error; err != nil {
		return err
	}
	if len(users) > 0 {
		return Conflict{fmt.Errorf("environment %s has sessions %s: remove them first", name, strings.Join(users, ", "))}
	}
	var actors []string
	if err := ws.DB.Model(&db.Seed{}).Where("environment_id = ? AND actor != ''", row.ID).Order("id DESC").
		Pluck("actor", &actors).Error; err != nil {
		return err
	}
	for _, a := range slices.Compact(actors) {
		if err := ws.Sandboxes.Delete(ctx, a); err != nil {
			return fmt.Errorf("seed %s: %w", a, err)
		}
	}
	if err := ws.unroute(ws.Preview(name)); err != nil {
		return err
	}
	// Removed sessions keep their environment's row, archived: their history still names it.
	var gone int64
	if err := ws.DB.Unscoped().Model(&db.Session{}).Where("environment_id = ?", row.ID).Count(&gone).Error; err != nil {
		return err
	}
	if gone == 0 {
		if err := ws.DB.Delete(&row).Error; err != nil {
			return err
		}
	} else if err := ws.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("environment_id = ?", row.ID).Delete(&db.Seed{}).Error; err != nil {
			return err
		}
		return tx.Model(&row).Update("archived_at", time.Now()).Error
	}); err != nil {
		return err
	}
	ws.Bus.Publish(Update{Kind: "reset"})
	return nil
}

// Every environment, and whether a session can fork from it now.
func (ws *Workspace) Environments() ([]EnvironmentSummary, error) {
	var rows []db.Environment
	if err := ws.DB.Where("archived_at IS NULL").Order("name").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := []EnvironmentSummary{}
	for _, e := range rows {
		_, err := ws.served(e.Name)
		out = append(out, EnvironmentSummary{Name: e.Name, Repo: e.Repo, Branch: e.Branch, Tier: e.Tier, Ready: err == nil})
	}
	return out, nil
}
