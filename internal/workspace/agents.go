package workspace

import (
	"errors"
	"fmt"
	"maps"
	"regexp"
	"slices"
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
	Default     string         `json:"default"` // the level "default" grants it at: auto or approval
}

// A tool the agent has, and whether a call runs or waits for a person. A tool it is not granted does not exist for it.
type Grant struct {
	Tool  string `json:"tool"`
	Level string `json:"level"`
}

type Agent struct {
	Name         string  `json:"name"`
	Description  string  `json:"description,omitempty"`
	Model        string  `json:"model,omitempty"` // empty runs on the credential's
	Instructions string  `json:"instructions,omitempty"`
	Tools        []Grant `json:"tools"`
}

// An agent as its file declares it. Tools maps a tool to auto, approval or default (the tool's own); "*" grants every
// tool, a tool named beside it overrides it. A tool not granted does not exist for the agent.
type AgentInput struct {
	Description  string            `json:"description,omitempty" yaml:"description"`
	Model        string            `json:"model,omitempty" yaml:"model"`
	Instructions string            `json:"instructions,omitempty" yaml:"instructions"`
	Tools        map[string]string `json:"tools,omitempty" yaml:"tools"`
}

type Level struct {
	Level string `json:"level" enum:"auto,approval"`
}

var levels = []string{"auto", "approval"}

// The agent's row; the workspace's own agent is made the first time it is asked for.
func agentRow(tx *gorm.DB, name string) (db.Agent, error) {
	a := db.Agent{Name: name}
	var err error
	if name == agentName {
		err = tx.Where(&a).FirstOrCreate(&a).Error
	} else {
		err = tx.Where(&a).First(&a).Error
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return a, NotFound{fmt.Errorf("no agent %s", name)}
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

// The agent's level for the tool; empty when the agent is not granted it.
func (ws *Workspace) level(agent, name string) (string, error) {
	var p db.ToolPolicy
	err := ws.DB.Joins("JOIN agents ON agents.id = tool_policies.agent_id").
		Where("agents.name = ? AND tool_policies.tool = ?", agent, name).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("agent %s, tool %s: %w", agent, name, err)
	}
	return p.Level, nil
}

// The MCP definitions of the tools the agent is granted.
func (ws *Workspace) given(agent string) ([]map[string]any, error) {
	a, err := ws.Agent(agent)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, g := range a.Tools {
		t, err := ws.tool(g.Tool)
		if err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"name": t.Name, "description": t.Description, "inputSchema": t.Schema})
	}
	return out, nil
}

func (ws *Workspace) Agents() ([]Agent, error) {
	if _, err := agentRow(ws.DB, agentName); err != nil {
		return nil, err
	}
	var names []string
	if err := ws.DB.Model(&db.Agent{}).Where("archived_at IS NULL").Order("name").Pluck("name", &names).Error; err != nil {
		return nil, err
	}
	out := []Agent{}
	for _, s := range names {
		a, err := ws.Agent(s)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// The agent, with the tools it is granted.
func (ws *Workspace) Agent(name string) (Agent, error) {
	row, err := agentRow(ws.DB, name)
	if err != nil {
		return Agent{}, err
	}
	var rules []db.ToolPolicy
	if err := ws.DB.Where("agent_id = ?", row.ID).Find(&rules).Error; err != nil {
		return Agent{}, err
	}
	a := Agent{Name: row.Name, Description: row.Description, Model: row.Model, Instructions: row.Instructions,
		Tools: []Grant{}}
	for _, r := range rules {
		if _, err := ws.tool(r.Tool); err == nil {
			a.Tools = append(a.Tools, Grant{Tool: r.Tool, Level: r.Level})
		}
	}
	sort.Slice(a.Tools, func(i, j int) bool { return a.Tools[i].Tool < a.Tools[j].Tool })
	return a, nil
}

func validLevel(level string) error {
	for _, l := range levels {
		if l == level {
			return nil
		}
	}
	return Invalid{fmt.Errorf("level %q is not auto or approval", level)}
}

// Grants the agent the tool at level, or changes the level it has it at.
func (ws *Workspace) Grant(agent, name, level string) (Agent, error) {
	if err := validLevel(level); err != nil {
		return Agent{}, err
	}
	if _, err := ws.tool(name); err != nil {
		return Agent{}, err
	}
	row, err := agentRow(ws.DB, agent)
	if err != nil {
		return Agent{}, err
	}
	if err := ws.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "agent_id"}, {Name: "tool"}},
		DoUpdates: clause.AssignmentColumns([]string{"level"})}).
		Create(&db.ToolPolicy{AgentID: row.ID, Tool: name, Level: level}).Error; err != nil {
		return Agent{}, err
	}
	return ws.Agent(agent)
}

// Takes the tool from the agent; one it does not have is no error.
func (ws *Workspace) Revoke(agent, name string) (Agent, error) {
	row, err := agentRow(ws.DB, agent)
	if err != nil {
		return Agent{}, err
	}
	if err := ws.DB.Where("agent_id = ? AND tool = ?", row.ID, name).Delete(&db.ToolPolicy{}).Error; err != nil {
		return Agent{}, err
	}
	return ws.Agent(agent)
}

// Makes the agent as in declares it, or makes an existing one so: its grants are replaced by in's. Declaring the same
// agent again changes nothing.
func (ws *Workspace) PutAgent(name string, in AgentInput) (Agent, error) {
	if !agentNames.MatchString(name) {
		return Agent{}, Invalid{fmt.Errorf("agent name %q: lowercase letters, digits and -, from a letter", name)}
	}
	defaults := map[string]string{}
	for _, t := range ws.Tools.List() {
		defaults[t.Name] = t.Default
	}
	set := map[string]string{}
	grant := func(tool, l string) error {
		if l == "default" {
			l = defaults[tool]
		}
		if err := validLevel(l); err != nil {
			return Invalid{fmt.Errorf("tool %s: %w", tool, err)}
		}
		set[tool] = l
		return nil
	}
	if l, ok := in.Tools["*"]; ok {
		for tool := range defaults {
			if err := grant(tool, l); err != nil {
				return Agent{}, err
			}
		}
	}
	for tool, l := range in.Tools {
		if tool == "*" {
			continue
		}
		if _, ok := defaults[tool]; !ok {
			return Agent{}, Invalid{fmt.Errorf("no tool %s", tool)}
		}
		if err := grant(tool, l); err != nil {
			return Agent{}, err
		}
	}
	err := ws.DB.Transaction(func(tx *gorm.DB) error {
		var row db.Agent
		if err := tx.Where("name = ?", name).First(&row).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		row.Name, row.Description, row.Model, row.Instructions, row.ArchivedAt = name, in.Description, in.Model,
			in.Instructions, nil
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if err := tx.Where("agent_id = ?", row.ID).Delete(&db.ToolPolicy{}).Error; err != nil {
			return err
		}
		for _, tool := range slices.Sorted(maps.Keys(set)) {
			if err := tx.Create(&db.ToolPolicy{AgentID: row.ID, Tool: tool, Level: set[tool]}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Agent{}, err
	}
	return ws.Agent(name)
}

var agentNames = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
