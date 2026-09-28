// An agent CLI as the plane sees it: its credential, its install, one turn's command line and how its output reads.
package llm

import (
	"fmt"
	"slices"
	"strings"

	"github.com/getnvoi/host0/shared/contract"
)

// One value of a runner's credential. Options, when set, is the closed set it must be in.
type Field struct {
	Key      string
	Secret   bool
	Required bool
	Options  []string
	Default  string
}

type Turn struct {
	Prompt, Session, Model, Instructions, MCP string
}

type Runner interface {
	// The name a credential stores.
	Key() string
	Label() string
	Fields() []Field
	// Shell that installs the CLI in the seed; does nothing when it is there.
	Install() string
	// The process environment a turn runs under, from values Check accepted.
	Env(values map[string]string) map[string]string
	// Session empty starts a conversation; otherwise the turn continues it.
	Argv(t Turn) []string
	Events(line string) []contract.Event
	// The conversation id a line of output names, empty when it names none.
	Transcript(line string) string
	// The hz tool a tool_use calls, without the prefix the CLI adds.
	Tool(name string) (string, bool)
	// Output saying the CLI lost its API rather than the turn failing.
	Transient(text string) bool
	// The prompt that has the agent pass a message to the sub-agent tool call to started.
	Relay(events []contract.Event, to, prompt string) (string, error)
}

func Find(runners []Runner, key string) (Runner, error) {
	var keys []string
	for _, r := range runners {
		if r.Key() == key {
			return r, nil
		}
		keys = append(keys, r.Key())
	}
	if key == "" {
		return nil, fmt.Errorf("no agent credential: run hz credentials (providers: %s)", strings.Join(keys, ", "))
	}
	return nil, fmt.Errorf("no provider %q (providers: %s)", key, strings.Join(keys, ", "))
}

// The runner a credential names and its values with defaults filled; a value the runner does not declare is refused.
func Check(runners []Runner, c contract.LLM) (Runner, map[string]string, error) {
	r, err := Find(runners, c.Provider)
	if err != nil {
		return nil, nil, err
	}
	out := map[string]string{}
	fields := map[string]bool{}
	for _, f := range r.Fields() {
		fields[f.Key] = true
		v := c.Values[f.Key]
		if v == "" {
			v = f.Default
		}
		switch {
		case v == "" && f.Required:
			return nil, nil, fmt.Errorf("%s: %s is required", r.Key(), f.Key)
		case v != "" && len(f.Options) > 0 && !slices.Contains(f.Options, v):
			return nil, nil, fmt.Errorf("%s: %s must be one of %s", r.Key(), f.Key, strings.Join(f.Options, ", "))
		}
		if v != "" {
			out[f.Key] = v
		}
	}
	for k := range c.Values {
		if !fields[k] {
			return nil, nil, fmt.Errorf("%s: no field %s", r.Key(), k)
		}
	}
	return r, out, nil
}
