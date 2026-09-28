// What the CLI and the plane say to each other.
package contract

import (
	"encoding/json"
	"time"
)

type Service struct {
	Name    string            `json:"name" yaml:"name"`
	Image   string            `json:"image,omitempty" yaml:"image"` // defaults to the environment's
	Command string            `json:"command" yaml:"command"`
	Port    int               `json:"port,omitempty" yaml:"port"`
	Env     map[string]string `json:"env,omitempty" yaml:"env"`
	// Starts before the checkout is ready; everything else waits for it.
	Early bool `json:"early,omitempty" yaml:"early"`
}

type Environment struct {
	Name     string            `json:"name" yaml:"name"`
	Repo     string            `json:"repo" yaml:"repo"` // owner/name
	Branch   string            `json:"branch" yaml:"branch"`
	Image    string            `json:"image" yaml:"image"`
	Env      map[string]string `json:"env,omitempty" yaml:"env"`
	Secrets  map[string]string `json:"secrets,omitempty" yaml:"-"`
	Setup    []string          `json:"setup" yaml:"setup"`
	Services []Service         `json:"services" yaml:"services"`
	Preview  int               `json:"preview" yaml:"preview"`
	Tier     string            `json:"tier,omitempty" yaml:"tier"` // small, medium (default) or large
	// Tool name to policy: auto, approval or deny.
	Tools map[string]string `json:"tools" yaml:"tools"`
}

type Credentials struct {
	GitHub string `json:"github,omitempty"`
}

// An agent credential. Its name is its id; turns run on the one live credential that is main.
type LLMConfig struct {
	Name     string            `json:"name"`
	Provider string            `json:"provider"`
	Values   map[string]string `json:"values"`
	// The secret fields holding a value; their values never leave the plane.
	Stored   []string   `json:"stored,omitempty"`
	Main     bool       `json:"main"`
	Archived *time.Time `json:"archived_at,omitempty"`
	At       time.Time  `json:"at"`
}

// An agent CLI a credential can be for, and the form of that credential.
type Provider struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Fields []Field `json:"fields"`
}

type Field struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Type        string   `json:"type"` // text, password or select
	Secret      bool     `json:"secret,omitempty"`
	Required    bool     `json:"required,omitempty"`
	Options     []Option `json:"options,omitempty"`
	Default     string   `json:"default,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Help        string   `json:"help,omitempty"`
}

type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type Seed struct {
	Env      string    `json:"env"`
	Run      string    `json:"run,omitempty"` // the seed script's boxd run id
	Actor    string    `json:"actor"`
	Template string    `json:"template"`
	Tag      string    `json:"tag"`
	State    string    `json:"state"` // building, ready, failed
	Error    string    `json:"error,omitempty"`
	Preview  string    `json:"preview,omitempty"`
	Spec     string    `json:"spec,omitempty"` // digest of the containers it was built from
	At       time.Time `json:"at"`
}

type Event struct {
	Kind    string `json:"kind"` // status, message, thinking, tool_use, tool_result, task, result, error, notice
	Tool    string `json:"tool,omitempty"`
	Content string `json:"content,omitempty"`
	ToolID  string `json:"tool_id,omitempty"`
	// The tool_use id of the sub-agent call this event happened inside; empty for the main agent.
	Parent string          `json:"parent,omitempty"`
	At     time.Time       `json:"at"`
	Meta   json.RawMessage `json:"meta,omitempty"`
}

type Session struct {
	ID         string  `json:"id"`
	Env        string  `json:"env"`
	Actor      string  `json:"actor"`
	Branch     string  `json:"branch"`
	Preview    string  `json:"preview"`
	Transcript string  `json:"transcript"` // the runner's session id
	Turns      int     `json:"turns"`
	State      string  `json:"state"` // forking, running, idle, awaiting_approval, failed
	Title      string  `json:"title,omitempty"`
	Error      string  `json:"error,omitempty"`
	Events     []Event `json:"events"`
	// Where the running turn's prompt sits in Events, so a plane that restarts can follow the turn again from there.
	Mark int `json:"mark"`
	// The prompt to run next, saved before it starts: the first one while the fork is made, a queued message or an
	// outcome while the sandbox wakes. Empty once the prompt is in Events.
	Pending string `json:"pending,omitempty"`
	// The sandbox was made and the branch checked out.
	Forked bool `json:"forked,omitempty"`
	// What the auto tools of a turn did, kept until its approvals are decided and all go into one outcome turn.
	Outcomes []string  `json:"outcomes,omitempty"`
	By       string    `json:"by,omitempty"` // who started it: a browser's label, or cli
	At       time.Time `json:"at"`
	Last     time.Time `json:"last"`
}

// A session without its events, for lists.
type Summary struct {
	ID      string    `json:"id"`
	Env     string    `json:"env"`
	Branch  string    `json:"branch"`
	Preview string    `json:"preview"`
	State   string    `json:"state"`
	Title   string    `json:"title,omitempty"`
	Prompt  string    `json:"prompt"`
	Error   string    `json:"error,omitempty"`
	Queued  int       `json:"queued"`
	By      string    `json:"by,omitempty"`
	At      time.Time `json:"at"`
	Last    time.Time `json:"last"`
}

func (s Session) Summary() Summary {
	var prompt string
	for _, e := range s.Events {
		if e.Kind == "prompt" {
			prompt = e.Content
			break
		}
	}
	return Summary{ID: s.ID, Env: s.Env, Branch: s.Branch, Preview: s.Preview, State: s.State, Title: s.Title,
		Prompt: prompt, Error: s.Error, By: s.By, At: s.At, Last: s.Last}
}

// What the UI is told as it happens: a session changed, events were appended to it, an approval changed.
type Update struct {
	Kind     string    `json:"kind"` // session, approval, reset
	Session  *Summary  `json:"session,omitempty"`
	From     int       `json:"from"` // index of the first event in Events; sent at 0 too
	Events   []Event   `json:"events,omitempty"`
	Approval *Approval `json:"approval,omitempty"`
}

type EnvironmentSummary struct {
	Name   string `json:"name"`
	Repo   string `json:"repo"`
	Branch string `json:"branch"`
	Tier   string `json:"tier"`
	Ready  bool   `json:"ready"`
}

type Approval struct {
	ID      string    `json:"id"`
	Session string    `json:"session"`
	Turn    int       `json:"turn,omitempty"` // the session's turn that asked for it
	Tool    string    `json:"tool"`
	Input   string    `json:"input"`
	State   string    `json:"state"` // pending, deciding, denied, done, stopped, failed
	Outcome string    `json:"outcome,omitempty"`
	At      time.Time `json:"at"`
	Decided time.Time `json:"decided,omitzero"`
	By      string    `json:"by,omitempty"`    // who decided
	Allow   bool      `json:"allow,omitempty"` // the decision, kept while it is carried out
}

type notFound struct{}

func (notFound) Error() string { return "not found" }

var ErrNotFound error = notFound{}

// A session's work against its environment's branch.
type Changes struct {
	Base      string       `json:"base"` // the ref diffed against: origin/<branch>, or HEAD when that is unknown
	At        time.Time    `json:"at"`
	Added     int          `json:"added"`
	Removed   int          `json:"removed"`
	Truncated bool         `json:"truncated"`
	Files     []FileChange `json:"files"`
	Patch     string       `json:"patch"`
}

type FileChange struct {
	Path    string `json:"path"`
	OldPath string `json:"old_path,omitempty"`
	Status  string `json:"status"` // added, modified, deleted, renamed
	Added   int    `json:"added"`
	Removed int    `json:"removed"`
	Binary  bool   `json:"binary"`
}

type Log struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // setup, service
}

// Usage over a range of days, for everyone or one person.
type Usage struct {
	From         string     `json:"from"` // YYYY-MM-DD, UTC
	To           string     `json:"to"`
	People       []string   `json:"people"`
	Totals       UsageTotal `json:"totals"`
	Days         []UsageDay `json:"days"` // every day in range, oldest first
	Environments []UsageEnv `json:"environments"`
}

type UsageTotal struct {
	Sessions       int     `json:"sessions"`
	Compute        float64 `json:"compute_minutes"` // running minutes
	PullRequests   int     `json:"pull_requests"`
	Tokens         int64   `json:"tokens"`
	Approvals      int     `json:"approvals"`
	ApprovalWaitMS int64   `json:"approval_wait_ms"` // median, created to decided
}

type UsageDay struct {
	Day          string             `json:"day"`
	Compute      map[string]float64 `json:"compute"` // environment to running minutes
	States       map[string]float64 `json:"states"`  // running, paused, suspended minutes
	Sessions     int                `json:"sessions"`
	PullRequests int                `json:"pull_requests"`
	Tokens       int64              `json:"tokens"`
	Nodes        float64            `json:"nodes"` // worker minutes; zero when scoped to a person
}

type UsageEnv struct {
	Name         string  `json:"name"`
	Compute      float64 `json:"compute_minutes"`
	Sessions     int     `json:"sessions"`
	PullRequests int     `json:"pull_requests"`
	Tokens       int64   `json:"tokens"`
}

// Whether a session's app answers its preview. Up is any status below 500; Error says why nothing answered.
type PreviewStatus struct {
	Up     bool   `json:"up"`
	Status int    `json:"status,omitempty"`
	Error  string `json:"error,omitempty"`
}
