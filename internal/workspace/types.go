package workspace

// What the CLI and the plane say to each other: a workspace's records, and the answers built from them.

import (
	"time"

	"github.com/getnvoi/host0/internal/llm"
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
	Name   string            `json:"name,omitempty" yaml:"name"`
	Repo   string            `json:"repo,omitempty" yaml:"repo"` // owner/name
	Branch string            `json:"branch,omitempty" yaml:"branch"`
	Image  string            `json:"image,omitempty" yaml:"image"`
	Env    map[string]string `json:"env,omitempty" yaml:"env"`
	// Name to value; the plane answers with the names and empty values.
	Secrets  map[string]string `json:"secrets,omitempty" yaml:"-"`
	Setup    []string          `json:"setup,omitempty" yaml:"setup"`
	Services []Service         `json:"services,omitempty" yaml:"services"`
	Preview  int               `json:"preview,omitempty" yaml:"preview"`
	Tier     string            `json:"tier,omitempty" yaml:"tier"` // small, medium (default) or large
}

// An environment as PUT declares it: everything is replaced, but a secret given empty keeps its value.
type EnvironmentInput Environment

// A merge patch (RFC 7386) of an environment: what is given replaces, null removes, an object merges.
type EnvironmentPatch struct {
	Repo     string            `json:"repo,omitempty"`
	Branch   string            `json:"branch,omitempty"`
	Image    string            `json:"image,omitempty"`
	Preview  int               `json:"preview,omitempty"`
	Tier     string            `json:"tier,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Secrets  map[string]string `json:"secrets,omitempty" writeOnly:"true"`
	Setup    []string          `json:"setup,omitempty"`
	Services []Service         `json:"services,omitempty"`
}

type Credentials struct {
	GitHub string `json:"github,omitempty"`
}

// The credentials that hold a value, by name; the values never leave the plane.
type CredentialsSet struct {
	Stored []string `json:"stored"`
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

// A new agent credential; the first live one, or one given main, is the one turns run on.
type LLMConfigInput struct {
	Name     string            `json:"name"`
	Provider string            `json:"provider"`
	Values   map[string]string `json:"values" writeOnly:"true"`
	Main     bool              `json:"main,omitempty"`
}

// A credential's values; a secret left empty keeps the stored one.
type LLMConfigValues struct {
	Values map[string]string `json:"values" writeOnly:"true"`
}

type CredentialsInput Credentials

type Seed struct {
	ID       uint      `json:"-"` // its row
	Env      string    `json:"env"`
	Run      string    `json:"run,omitempty"` // the seed script's boxd run id
	Actor    string    `json:"actor"`
	Template string    `json:"template"`
	Tag      string    `json:"tag"`
	State    string    `json:"state"`           // building, ready, failed
	Step     string    `json:"step,omitempty"`  // what the build is doing now
	Line     string    `json:"line,omitempty"`  // the build's last line of output, sent on the stream only
	Lines    int       `json:"lines,omitempty"` // lines of output so far; a beat that repeats it reports no progress
	Error    string    `json:"error,omitempty"`
	Preview  string    `json:"preview,omitempty"`
	Spec     string    `json:"spec,omitempty"` // digest of the containers it was built from
	At       time.Time `json:"at"`
}

type Session struct {
	ID         string      `json:"id"`
	Env        string      `json:"env"`
	Agent      string      `json:"agent"` // the slug of the agent it runs as
	Actor      string      `json:"actor"`
	Branch     string      `json:"branch"`
	Preview    string      `json:"preview"`
	Transcript string      `json:"transcript"` // the runner's session id
	Turns      int         `json:"turns"`
	State      string      `json:"state"` // forking, running, idle, awaiting_approval, failed
	Title      string      `json:"title,omitempty"`
	Error      string      `json:"error,omitempty"`
	Events     []llm.Event `json:"events"`
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

// A new session: a fork of the environment's seed. An empty prompt forks and rests.
type SessionInput struct {
	Env    string `json:"env" doc:"The environment whose seed it forks"`
	Agent  string `json:"agent,omitempty" doc:"The agent it runs as; h0 when none is named"`
	Prompt string `json:"prompt,omitempty" doc:"Its first message"`
}

// A message to a session: run now when it rests, queued otherwise.
type Message struct {
	Prompt string `json:"prompt"`
	To     string `json:"to,omitempty" doc:"The sub-agent's tool call it is for; the main agent passes it on"`
}

// The text a queued message must still hold, so a stale click does not withdraw its neighbour.
type Withdrawal struct {
	Text string `json:"text"`
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

// What the UI is told as it happens: a session changed, events were appended to it, an approval or a seed changed.
type Update struct {
	Kind     string      `json:"kind"` // session, approval, seed, reset
	Session  *Summary    `json:"session,omitempty"`
	From     int         `json:"from"` // index of the first event in Events; sent at 0 too
	Events   []llm.Event `json:"events,omitempty"`
	Approval *Approval   `json:"approval,omitempty"`
	Seed     *Seed       `json:"seed,omitempty"`
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
	ToolID  string    `json:"tool_id,omitempty"` // the tool_use that asked for it
	Input   string    `json:"input"`
	State   string    `json:"state"` // pending, deciding, denied, done, stopped, failed
	Outcome string    `json:"outcome,omitempty"`
	At      time.Time `json:"at"`
	Decided time.Time `json:"decided,omitzero"`
	By      string    `json:"by,omitempty"`    // who decided
	Allow   bool      `json:"allow,omitempty"` // the decision, kept while it is carried out
}

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
