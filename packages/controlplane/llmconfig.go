package controlplane

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/getnvoi/host0/controlplane/llm"
	"github.com/getnvoi/host0/shared/contract"
)

// Guards the llm rows: which one is main is decided across all of them.
var configs sync.Mutex

func (p *Plane) Providers() []contract.Provider {
	out := make([]contract.Provider, len(Runners))
	for i, r := range Runners {
		out[i] = llm.Describe(r)
	}
	return out
}

// Live first, then archived, each oldest first; secrets left out.
func (p *Plane) Configs() ([]contract.LLMConfig, error) {
	all, err := p.configs()
	if err != nil {
		return nil, err
	}
	for i := range all {
		all[i] = redact(all[i])
	}
	return all, nil
}

func (p *Plane) configs() ([]contract.LLMConfig, error) {
	var all []contract.LLMConfig
	err := p.Store.List("llm", func(d func(any) error) error {
		var c contract.LLMConfig
		if err := d(&c); err != nil {
			return err
		}
		all = append(all, c)
		return nil
	})
	sort.SliceStable(all, func(i, j int) bool {
		if (all[i].Archived == nil) != (all[j].Archived == nil) {
			return all[i].Archived == nil
		}
		return all[i].At.Before(all[j].At)
	})
	return all, err
}

func redact(c contract.LLMConfig) contract.LLMConfig {
	r, err := llm.Find(Runners, c.Provider)
	if err != nil {
		c.Values = nil
		return c
	}
	values := map[string]string{}
	for _, f := range r.Fields() {
		v := c.Values[f.Key]
		switch {
		case v == "":
		case f.Secret:
			c.Stored = append(c.Stored, f.Key)
		default:
			values[f.Key] = v
		}
	}
	c.Values = values
	return c
}

func (p *Plane) config(name string) (contract.LLMConfig, error) {
	var c contract.LLMConfig
	return c, p.Store.Get("llm", name, &c)
}

// Adds a credential; the first live one is main.
func (p *Plane) AddConfig(in contract.LLMConfig) (contract.LLMConfig, error) {
	configs.Lock()
	defer configs.Unlock()
	name := strings.TrimSpace(in.Name)
	switch {
	case name == "":
		return in, badRequest{errors.New("Give it a label, like Anthropic work.")}
	case strings.ContainsAny(name, "/?#"):
		return in, badRequest{errors.New("A label cannot hold / ? or #.")}
	}
	if _, err := p.config(name); err == nil {
		return in, conflict{fmt.Errorf("Another credential is called %s. Pick another label.", name)}
	} else if err != ErrNotFound {
		return in, err
	}
	_, values, err := llm.Check(Runners, in.Provider, in.Values)
	if err != nil {
		return in, badRequest{err}
	}
	c := contract.LLMConfig{Name: name, Provider: in.Provider, Values: values, At: time.Now()}
	main, err := p.main()
	if err != nil {
		return in, err
	}
	if in.Main || main == nil {
		c.Main = true
		return redact(c), p.promote(c)
	}
	return redact(c), p.Store.Put("llm", name, c)
}

// Changes a credential's values; the provider stays, and a secret left empty keeps the stored one.
func (p *Plane) UpdateConfig(name string, values map[string]string) (contract.LLMConfig, error) {
	configs.Lock()
	defer configs.Unlock()
	c, err := p.config(name)
	if err != nil {
		return c, err
	}
	r, err := llm.Find(Runners, c.Provider)
	if err != nil {
		return c, err
	}
	merged := map[string]string{}
	for k, v := range values {
		merged[k] = v
	}
	for _, f := range r.Fields() {
		if f.Secret && merged[f.Key] == "" && c.Values[f.Key] != "" {
			merged[f.Key] = c.Values[f.Key]
		}
	}
	if _, c.Values, err = llm.Check(Runners, c.Provider, merged); err != nil {
		return c, badRequest{err}
	}
	return redact(c), p.Store.Put("llm", name, c)
}

// Makes a live credential the one turns run on.
func (p *Plane) UseConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	c, err := p.config(name)
	if err != nil {
		return err
	}
	if c.Archived != nil {
		return conflict{fmt.Errorf("%s is archived. Restore it first.", name)}
	}
	return p.promote(c)
}

// Archives a credential; an archived main hands over to the oldest live one.
func (p *Plane) ArchiveConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	c, err := p.config(name)
	if err != nil {
		return err
	}
	now := time.Now()
	c.Archived, c.Main = &now, false
	if err := p.Store.Put("llm", name, c); err != nil {
		return err
	}
	return p.handOver()
}

func (p *Plane) RestoreConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	c, err := p.config(name)
	if err != nil {
		return err
	}
	c.Archived = nil
	if err := p.Store.Put("llm", name, c); err != nil {
		return err
	}
	return p.handOver()
}

func (p *Plane) RemoveConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	if _, err := p.config(name); err != nil {
		return err
	}
	if err := p.Store.Delete("llm", name); err != nil {
		return err
	}
	return p.handOver()
}

// The live main credential, nil when there is none.
func (p *Plane) main() (*contract.LLMConfig, error) {
	all, err := p.configs()
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(all, func(c contract.LLMConfig) bool { return c.Main && c.Archived == nil })
	if i < 0 {
		return nil, nil
	}
	return &all[i], nil
}

// Saves c as main and every other row as not.
func (p *Plane) promote(c contract.LLMConfig) error {
	all, err := p.configs()
	if err != nil {
		return err
	}
	for _, o := range all {
		if o.Main && o.Name != c.Name {
			o.Main = false
			if err := p.Store.Put("llm", o.Name, o); err != nil {
				return err
			}
		}
	}
	c.Main = true
	return p.Store.Put("llm", c.Name, c)
}

// With no live main, the oldest live credential becomes it.
func (p *Plane) handOver() error {
	all, err := p.configs()
	if err != nil {
		return err
	}
	for _, c := range all {
		if c.Main && c.Archived == nil {
			return nil
		}
	}
	for _, c := range all {
		if c.Archived == nil {
			return p.promote(c)
		}
	}
	return nil
}

// The runner of the main credential, and its values.
func (p *Plane) runner() (llm.Runner, map[string]string, error) {
	c, err := p.main()
	if err != nil {
		return nil, nil, err
	}
	if c == nil {
		return nil, nil, errors.New("no agent credential: add one in Model credentials, or run hz credentials")
	}
	return llm.Check(Runners, c.Provider, c.Values)
}
