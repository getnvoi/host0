package workspace

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
)

// Guards the llm rows: which one is main is decided across all of them.
var configs sync.Mutex

func (ws *Workspace) Providers() []llm.Provider {
	out := make([]llm.Provider, len(ws.Runners))
	for i, r := range ws.Runners {
		out[i] = llm.Describe(r)
	}
	return out
}

// Live first, then archived, each oldest first; secrets left out.
func (ws *Workspace) Configs() ([]LLMConfig, error) {
	all, err := ws.configs()
	if err != nil {
		return nil, err
	}
	for i := range all {
		all[i] = ws.redact(all[i])
	}
	return all, nil
}

func (ws *Workspace) configs() ([]LLMConfig, error) {
	var rows []db.LLMConfig
	if err := ws.DB.Order("archived_at IS NOT NULL, created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	all := make([]LLMConfig, len(rows))
	for i, r := range rows {
		all[i] = LLMConfig{Name: r.Name, Provider: r.Provider, Values: r.Values, Main: r.Main, Archived: r.ArchivedAt,
			At: r.CreatedAt}
	}
	return all, nil
}

func (ws *Workspace) redact(c LLMConfig) LLMConfig {
	r, err := llm.Find(ws.Runners, c.Provider)
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

func (ws *Workspace) config(name string) (LLMConfig, error) {
	var r db.LLMConfig
	err := ws.DB.Where("name = ?", name).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return LLMConfig{}, NotFound{fmt.Errorf("no agent credential %s", name)}
	}
	return LLMConfig{Name: r.Name, Provider: r.Provider, Values: r.Values, Main: r.Main, Archived: r.ArchivedAt, At: r.CreatedAt}, err
}

// Writes c over the row of its name, or as a new one.
func (ws *Workspace) saveConfig(c LLMConfig) error {
	var r db.LLMConfig
	if err := ws.DB.Where("name = ?", c.Name).First(&r).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	r.Name, r.Provider, r.Kind, r.Values, r.Main, r.ArchivedAt = c.Name, c.Provider, c.Values["kind"], c.Values, c.Main, c.Archived
	return ws.DB.Save(&r).Error
}

// Adds a credential; the first live one is main.
func (ws *Workspace) AddConfig(in LLMConfigInput) (LLMConfig, error) {
	configs.Lock()
	defer configs.Unlock()
	name := strings.TrimSpace(in.Name)
	switch {
	case name == "":
		return LLMConfig{}, Invalid{errors.New("Give it a label, like Anthropic work.")}
	case strings.ContainsAny(name, "/?#"):
		return LLMConfig{}, Invalid{errors.New("A label cannot hold / ? or #.")}
	}
	if _, err := ws.config(name); err == nil {
		return LLMConfig{}, Conflict{fmt.Errorf("Another credential is called %s. Pick another label.", name)}
	} else if !errors.As(err, new(NotFound)) {
		return LLMConfig{}, err
	}
	_, values, err := llm.Check(ws.Runners, in.Provider, in.Values)
	if err != nil {
		return LLMConfig{}, Invalid{err}
	}
	c := LLMConfig{Name: name, Provider: in.Provider, Values: values}
	main, err := ws.main()
	if err != nil {
		return LLMConfig{}, err
	}
	if in.Main || main == nil {
		c.Main = true
		return ws.redact(c), ws.promote(c)
	}
	return ws.redact(c), ws.saveConfig(c)
}

// Changes a credential's values; the provider stays, and a secret left empty keeps the stored one.
func (ws *Workspace) UpdateConfig(name string, values map[string]string) (LLMConfig, error) {
	configs.Lock()
	defer configs.Unlock()
	c, err := ws.config(name)
	if err != nil {
		return c, err
	}
	r, err := llm.Find(ws.Runners, c.Provider)
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
	if _, c.Values, err = llm.Check(ws.Runners, c.Provider, merged); err != nil {
		return c, Invalid{err}
	}
	return ws.redact(c), ws.saveConfig(c)
}

// Makes a live credential the one turns run on.
func (ws *Workspace) UseConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	c, err := ws.config(name)
	if err != nil {
		return err
	}
	if c.Archived != nil {
		return Conflict{fmt.Errorf("%s is archived. Restore it first.", name)}
	}
	return ws.promote(c)
}

// Archives a credential; an archived main hands over to the oldest live one.
func (ws *Workspace) ArchiveConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	c, err := ws.config(name)
	if err != nil {
		return err
	}
	now := time.Now()
	c.Archived, c.Main = &now, false
	if err := ws.saveConfig(c); err != nil {
		return err
	}
	return ws.handOver()
}

func (ws *Workspace) RestoreConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	c, err := ws.config(name)
	if err != nil {
		return err
	}
	c.Archived = nil
	if err := ws.saveConfig(c); err != nil {
		return err
	}
	return ws.handOver()
}

func (ws *Workspace) RemoveConfig(name string) error {
	configs.Lock()
	defer configs.Unlock()
	if _, err := ws.config(name); err != nil {
		return err
	}
	if err := ws.DB.Where("name = ?", name).Delete(&db.LLMConfig{}).Error; err != nil {
		return err
	}
	return ws.handOver()
}

// The live main credential, nil when there is none.
func (ws *Workspace) main() (*LLMConfig, error) {
	all, err := ws.configs()
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(all, func(c LLMConfig) bool { return c.Main && c.Archived == nil })
	if i < 0 {
		return nil, nil
	}
	return &all[i], nil
}

// Saves c as main and every other row as not.
func (ws *Workspace) promote(c LLMConfig) error {
	all, err := ws.configs()
	if err != nil {
		return err
	}
	for _, o := range all {
		if o.Main && o.Name != c.Name {
			o.Main = false
			if err := ws.saveConfig(o); err != nil {
				return err
			}
		}
	}
	c.Main = true
	return ws.saveConfig(c)
}

// With no live main, the oldest live credential becomes it.
func (ws *Workspace) handOver() error {
	all, err := ws.configs()
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
			return ws.promote(c)
		}
	}
	return nil
}

// The runner of the main credential, and its values.
func (ws *Workspace) runner() (llm.Runner, map[string]string, error) {
	c, err := ws.main()
	if err != nil {
		return nil, nil, err
	}
	if c == nil {
		return nil, nil, errors.New("no agent credential: add one in Model credentials, or run h0 credentials")
	}
	return llm.Check(ws.Runners, c.Provider, c.Values)
}
