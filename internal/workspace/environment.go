package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/getnvoi/host0/internal/store"
)

// Held across each read and write of an environment row, so two patches do not lose one another.
var environments sync.Mutex

// The environment with its secrets' values left out.
func (ws *Workspace) Environment(name string) (Environment, error) {
	var e Environment
	if err := ws.Store.Get("environments", name, &e); err != nil {
		return e, err
	}
	return redacted(e), nil
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
func (ws *Workspace) PutEnvironment(e Environment) error {
	environments.Lock()
	defer environments.Unlock()
	var old Environment
	if err := ws.Store.Get("environments", e.Name, &old); err != nil && err != store.ErrNotFound {
		return err
	}
	return ws.store(e, old)
}

// Applies a JSON merge patch (RFC 7386): null removes a key, an object merges, anything else replaces.
func (ws *Workspace) PatchEnvironment(name string, patch []byte) (Environment, error) {
	environments.Lock()
	defer environments.Unlock()
	var old Environment
	if err := ws.Store.Get("environments", name, &old); err != nil {
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

// Writes e over old, under environments, once valid.
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
	return ws.Store.Put("environments", e.Name, e)
}

func (ws *Workspace) valid(e Environment) error {
	if e.Name == "" {
		return fmt.Errorf("an environment needs a name")
	}
	if _, err := ws.Workers.Tier(e.Tier); err != nil {
		return err
	}
	for tool, pol := range e.Tools {
		if pol != "auto" && pol != "approval" && pol != "deny" {
			return fmt.Errorf("tool %s: policy %q is not auto, approval or deny", tool, pol)
		}
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
	var e Environment
	if err := ws.Store.Get("environments", name, &e); err != nil {
		return err
	}
	if _, busy := seeding.LoadOrStore(name, true); busy {
		return Conflict{fmt.Errorf("the seed of %s is being built", name)}
	}
	defer seeding.Delete(name)
	var users []string
	err := ws.Store.List("sessions", func(d func(any) error) error {
		var s Session
		if err := d(&s); err != nil {
			return err
		}
		if s.Env == name {
			users = append(users, s.ID)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(users) > 0 {
		return Conflict{fmt.Errorf("environment %s has sessions %s: remove them first", name, strings.Join(users, ", "))}
	}
	for _, kind := range []string{"seeds", "ready"} {
		var s Seed
		err := ws.Store.Get(kind, name, &s)
		if err == store.ErrNotFound || (err == nil && s.Actor == "") {
			continue
		}
		if err != nil {
			return err
		}
		if err := ws.Sandboxes.Delete(ctx, s.Actor); err != nil {
			return fmt.Errorf("seed %s: %w", s.Actor, err)
		}
	}
	for _, row := range [][2]string{{"routes", ws.Preview(name)}, {"ready", name}, {"seeds", name}, {"environments", name}} {
		if err := ws.Store.Delete(row[0], row[1]); err != nil {
			return err
		}
	}
	ws.Bus.Publish(Update{Kind: "reset"})
	return nil
}

// Every environment, and whether a session can fork from it now.
func (ws *Workspace) Environments() ([]EnvironmentSummary, error) {
	out := []EnvironmentSummary{}
	err := ws.Store.List("environments", func(d func(any) error) error {
		var e Environment
		if err := d(&e); err != nil {
			return err
		}
		_, err := ws.served(e.Name)
		out = append(out, EnvironmentSummary{Name: e.Name, Repo: e.Repo, Branch: e.Branch, Tier: e.Tier, Ready: err == nil})
		return nil
	})
	return out, err
}
