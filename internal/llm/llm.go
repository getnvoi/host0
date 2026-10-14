// An agent CLI as the plane sees it: its credential, its install, one turn's command line and how its output reads.
package llm

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Turn struct {
	Prompt, Session, Model, Instructions, MCP string
}

type Runner interface {
	// The name a credential stores.
	Key() string
	Label() string
	// The credential's form, in the order it is asked; the field keyed model is the model.
	Fields() []Field
	// Shell that installs the CLI in the seed; does nothing when it is there.
	Install() string
	// The process environment a turn runs under, from values Check accepted.
	Env(values map[string]string) map[string]string
	// Session empty starts a conversation; otherwise the turn continues it.
	Argv(t Turn) []string
	Events(line string) []Event
	// The conversation id a line of output names, empty when it names none.
	Transcript(line string) string
	// The nvoi tool a tool_use calls, without the prefix the CLI adds.
	Tool(name string) (string, bool)
	// Output saying the CLI lost its API rather than the turn failing.
	Transient(text string) bool
	// The prompt that has the agent pass a message to the sub-agent tool call to started.
	Relay(events []Event, to, prompt string) (string, error)
}

func Describe(r Runner) Provider {
	return Provider{Key: r.Key(), Label: r.Label(), Fields: r.Fields()}
}

func Find(runners []Runner, key string) (Runner, error) {
	var keys []string
	for _, r := range runners {
		if r.Key() == key {
			return r, nil
		}
		keys = append(keys, r.Key())
	}
	return nil, fmt.Errorf("no provider %q (providers: %s)", key, strings.Join(keys, ", "))
}

// The runner a provider names and its values with defaults filled; a value the runner does not declare is refused.
func Check(runners []Runner, provider string, values map[string]string) (Runner, map[string]string, error) {
	r, err := Find(runners, provider)
	if err != nil {
		return nil, nil, err
	}
	out := map[string]string{}
	fields := map[string]bool{}
	for _, f := range r.Fields() {
		fields[f.Key] = true
		v := values[f.Key]
		if v == "" {
			v = f.Default
		}
		if v == "" && f.Required {
			return nil, nil, fmt.Errorf("%s is needed", f.Label)
		}
		if v != "" && len(f.Options) > 0 && !allowed(f.Options, v) {
			return nil, nil, fmt.Errorf("%s is not one of the choices", f.Label)
		}
		if v != "" {
			out[f.Key] = v
		}
	}
	for k := range values {
		if !fields[k] {
			return nil, nil, fmt.Errorf("%s has no field %s", r.Label(), k)
		}
	}
	return r, out, nil
}

func allowed(options []Option, v string) bool {
	for _, o := range options {
		if o.Value == v {
			return true
		}
	}
	return false
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
