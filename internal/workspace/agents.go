package workspace

import (
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/getnvoi/host0/internal/db"
)

// One operation of the plane's API, as an agent calls it.
type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Schema      map[string]any `json:"-"`       // its MCP input schema
	Default     string         `json:"default"` // its level for an agent with no rule for it
}

// An agent's level for a tool: its own rule, or the tool's default.
type Grant struct {
	Tool  string `json:"tool"`
	Level string `json:"level"`
	Rule  bool   `json:"rule"`
}

type Agent struct {
	Slug  string  `json:"slug"`
	Name  string  `json:"name"`
	Tools []Grant `json:"tools"`
}

type Level struct {
	Level string `json:"level" enum:"auto,approval,deny"`
}

var levels = []string{"auto", "approval", "deny"}

// The agent's row; the workspace's own agent is made the first time it is asked for.
func agentRow(tx *gorm.DB, slug string) (db.Agent, error) {
	a := db.Agent{Slug: slug}
	var err error
	if slug == agentSlug {
		err = tx.Where(&a).Attrs(db.Agent{Name: agentSlug}).FirstOrCreate(&a).Error
	} else {
		err = tx.Where(&a).First(&a).Error
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return a, NotFound{fmt.Errorf("no agent %s", slug)}
	}
	return a, err
}

// The tool named name.
func (ws *Workspace) tool(name string) (Tool, error) {
	for _, t := range ws.Tools.List() {
		if t.Name == name {
			return t, nil
		}
	}
	return Tool{}, NotFound{fmt.Errorf("no tool %s", name)}
}

// The agent's level for the tool: its rule, else the tool's default. A tool that does not exist is denied.
func (ws *Workspace) level(agent, name string) (string, error) {
	t, err := ws.tool(name)
	if err != nil {
		return "deny", nil
	}
	var p db.ToolPolicy
	err = ws.DB.Joins("JOIN agents ON agents.id = tool_policies.agent_id").
		Where("agents.slug = ? AND tool_policies.tool = ?", agent, name).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return t.Default, nil
	}
	if err != nil {
		return "", fmt.Errorf("agent %s, tool %s: %w", agent, name, err)
	}
	return p.Level, nil
}

// The MCP definitions of the tools the agent may call: every one it is not denied.
func (ws *Workspace) given(agent string) ([]map[string]any, error) {
	a, err := ws.Agent(agent)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, g := range a.Tools {
		if g.Level == "deny" {
			continue
		}
		t, err := ws.tool(g.Tool)
		if err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"name": t.Name, "description": t.Description, "inputSchema": t.Schema})
	}
	return out, nil
}

func (ws *Workspace) Agents() ([]Agent, error) {
	if _, err := agentRow(ws.DB, agentSlug); err != nil {
		return nil, err
	}
	var slugs []string
	if err := ws.DB.Model(&db.Agent{}).Where("archived_at IS NULL").Order("slug").Pluck("slug", &slugs).Error; err != nil {
		return nil, err
	}
	out := []Agent{}
	for _, s := range slugs {
		a, err := ws.Agent(s)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// The agent, with its level for every tool.
func (ws *Workspace) Agent(slug string) (Agent, error) {
	row, err := agentRow(ws.DB, slug)
	if err != nil {
		return Agent{}, err
	}
	var rules []db.ToolPolicy
	if err := ws.DB.Where("agent_id = ?", row.ID).Find(&rules).Error; err != nil {
		return Agent{}, err
	}
	set := map[string]string{}
	for _, r := range rules {
		set[r.Tool] = r.Level
	}
	a := Agent{Slug: row.Slug, Name: row.Name, Tools: []Grant{}}
	for _, t := range ws.Tools.List() {
		g := Grant{Tool: t.Name, Level: t.Default}
		if l, ok := set[t.Name]; ok {
			g.Level, g.Rule = l, true
		}
		a.Tools = append(a.Tools, g)
	}
	sort.Slice(a.Tools, func(i, j int) bool { return a.Tools[i].Tool < a.Tools[j].Tool })
	return a, nil
}

// Sets the agent's level for the tool, over the tool's default.
func (ws *Workspace) SetRule(slug, name, level string) (Agent, error) {
	valid := false
	for _, l := range levels {
		valid = valid || l == level
	}
	if !valid {
		return Agent{}, Invalid{fmt.Errorf("level %q is not auto, approval or deny", level)}
	}
	if _, err := ws.tool(name); err != nil {
		return Agent{}, err
	}
	row, err := agentRow(ws.DB, slug)
	if err != nil {
		return Agent{}, err
	}
	if err := ws.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "agent_id"}, {Name: "tool"}},
		DoUpdates: clause.AssignmentColumns([]string{"level"})}).
		Create(&db.ToolPolicy{AgentID: row.ID, Tool: name, Level: level}).Error; err != nil {
		return Agent{}, err
	}
	return ws.Agent(slug)
}

// Removes the agent's rule for the tool: its default applies again. A tool with no rule is no error.
func (ws *Workspace) DropRule(slug, name string) (Agent, error) {
	row, err := agentRow(ws.DB, slug)
	if err != nil {
		return Agent{}, err
	}
	if err := ws.DB.Where("agent_id = ? AND tool = ?", row.ID, name).Delete(&db.ToolPolicy{}).Error; err != nil {
		return Agent{}, err
	}
	return ws.Agent(slug)
}
