// The agents an install declares on the plane, one file each, in the fields of Anthropic's agent definitions.
package agents

import (
	"embed"
	"fmt"
	"path"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed *.yaml
var files embed.FS

// An agent file. Tools maps a tool to its level: auto, approval or deny; "*" is every tool.
type File struct {
	Name         string            `yaml:"name" json:"-"`
	Description  string            `yaml:"description" json:"description,omitempty"`
	Model        string            `yaml:"model" json:"model,omitempty"`
	Instructions string            `yaml:"instructions" json:"instructions,omitempty"`
	Tools        map[string]string `yaml:"tools" json:"tools,omitempty"`
}

// Every agent file, by name; a file whose name is not its agent's is refused.
func All() ([]File, error) {
	entries, err := files.ReadDir(".")
	if err != nil {
		return nil, err
	}
	var out []File
	for _, e := range entries {
		raw, err := files.ReadFile(e.Name())
		if err != nil {
			return nil, err
		}
		var f File
		dec := yaml.NewDecoder(strings.NewReader(string(raw)))
		dec.KnownFields(true)
		if err := dec.Decode(&f); err != nil {
			return nil, fmt.Errorf("agents/%s: %w", e.Name(), err)
		}
		if want := strings.TrimSuffix(e.Name(), path.Ext(e.Name())); f.Name != want {
			return nil, fmt.Errorf("agents/%s: names agent %q", e.Name(), f.Name)
		}
		out = append(out, f)
	}
	return out, nil
}
