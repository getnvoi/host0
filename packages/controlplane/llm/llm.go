// An agent CLI as the plane sees it: its credential, its install, one turn's command line and how its output reads.
package llm

import (
	"fmt"
	"strings"

	"github.com/getnvoi/host0/shared/contract"
)

type Turn struct {
	Prompt, Session, Model, Instructions, MCP string
}

type Runner interface {
	// The name a credential stores.
	Key() string
	Label() string
	// The credential's form, in the order it is asked; the field keyed model is the model.
	Fields() []contract.Field
	// Shell that installs the CLI in the seed; does nothing when it is there.
	Install() string
	// The process environment a turn runs under, from values Check accepted.
	Env(values map[string]string) map[string]string
	// Session empty starts a conversation; otherwise the turn continues it.
	Argv(t Turn) []string
	Events(line string) []contract.Event
	// The conversation id a line of output names, empty when it names none.
	Transcript(line string) string
	// The nvoi tool a tool_use calls, without the prefix the CLI adds.
	Tool(name string) (string, bool)
	// Output saying the CLI lost its API rather than the turn failing.
	Transient(text string) bool
	// The prompt that has the agent pass a message to the sub-agent tool call to started.
	Relay(events []contract.Event, to, prompt string) (string, error)
}

func Describe(r Runner) contract.Provider {
	return contract.Provider{Key: r.Key(), Label: r.Label(), Fields: r.Fields()}
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

func allowed(options []contract.Option, v string) bool {
	for _, o := range options {
		if o.Value == v {
			return true
		}
	}
	return false
}
