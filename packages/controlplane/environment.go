package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/tiers"
)

// Held across each read and write of an environment row, so two patches do not lose one another.
var environments sync.Mutex

// The environment with its secrets' values left out.
func (p *Plane) Environment(name string) (contract.Environment, error) {
	var e contract.Environment
	if err := p.Store.Get("environments", name, &e); err != nil {
		return e, err
	}
	return redacted(e), nil
}

func redacted(e contract.Environment) contract.Environment {
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
func (p *Plane) PutEnvironment(e contract.Environment) error {
	environments.Lock()
	defer environments.Unlock()
	var old contract.Environment
	if err := p.Store.Get("environments", e.Name, &old); err != nil && err != ErrNotFound {
		return err
	}
	return p.store(e, old)
}

// Applies a JSON merge patch (RFC 7386): null removes a key, an object merges, anything else replaces.
func (p *Plane) PatchEnvironment(name string, patch []byte) (contract.Environment, error) {
	environments.Lock()
	defer environments.Unlock()
	var old contract.Environment
	if err := p.Store.Get("environments", name, &old); err != nil {
		return old, err
	}
	var ch map[string]any
	if err := json.Unmarshal(patch, &ch); err != nil {
		return old, badRequest{fmt.Errorf("a patch is a JSON object: %w", err)}
	}
	known := fields(reflect.TypeOf(old))
	for k, v := range ch {
		if !known[k] {
			return old, badRequest{fmt.Errorf("unknown field %q", k)}
		}
		if k == "name" && v != name {
			return old, badRequest{fmt.Errorf("the name of %s does not change", name)}
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
	var e contract.Environment
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(&e); err != nil {
		return old, badRequest{err}
	}
	if err := p.store(e, old); err != nil {
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
func (p *Plane) store(e, old contract.Environment) error {
	for k, v := range e.Secrets {
		if v != "" {
			continue
		}
		if old.Secrets[k] == "" {
			return badRequest{fmt.Errorf("secret %s has no value", k)}
		}
		e.Secrets[k] = old.Secrets[k]
	}
	if err := valid(e); err != nil {
		return badRequest{err}
	}
	return p.Store.Put("environments", e.Name, e)
}

func valid(e contract.Environment) error {
	if e.Name == "" {
		return fmt.Errorf("an environment needs a name")
	}
	if _, err := tiers.Get(e.Tier); err != nil {
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
func (p *Plane) DeleteEnvironment(ctx context.Context, name string) error {
	environments.Lock()
	defer environments.Unlock()
	var e contract.Environment
	if err := p.Store.Get("environments", name, &e); err != nil {
		return err
	}
	if _, busy := seeding.LoadOrStore(name, true); busy {
		return conflict{fmt.Errorf("the seed of %s is being built", name)}
	}
	defer seeding.Delete(name)
	var users []string
	err := p.Store.List("sessions", func(d func(any) error) error {
		var s contract.Session
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
		return conflict{fmt.Errorf("environment %s has sessions %s: remove them first", name, strings.Join(users, ", "))}
	}
	for _, kind := range []string{"seeds", "ready"} {
		var s contract.Seed
		err := p.Store.Get(kind, name, &s)
		if err == ErrNotFound || (err == nil && s.Actor == "") {
			continue
		}
		if err != nil {
			return err
		}
		if err := p.Sandboxes.Delete(ctx, s.Actor); err != nil {
			return fmt.Errorf("seed %s: %w", s.Actor, err)
		}
	}
	for _, row := range [][2]string{{"routes", p.Preview(name)}, {"ready", name}, {"seeds", name}, {"environments", name}} {
		if err := p.Store.Delete(row[0], row[1]); err != nil {
			return err
		}
	}
	bus.publish(contract.Update{Kind: "reset"})
	return nil
}
