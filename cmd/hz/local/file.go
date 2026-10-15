package local

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/getnvoi/host0/internal/sandbox"
)

// cluster.yml: what cluster install and destroy take as flags, in one place. A flag given overrides the file.
// credentials map a provider's own key to the shell variable holding its value; no value is ever in the file.
type File struct {
	Name  string `yaml:"name"`
	Cloud struct {
		Provider    string            `yaml:"provider"`
		Location    string            `yaml:"location"`
		Credentials map[string]string `yaml:"credentials"`
	} `yaml:"cloud"`
	Control struct {
		Type string `yaml:"type"`
	} `yaml:"control"`
	Workers struct {
		Type string `yaml:"type"`
		Max  int    `yaml:"max"`
		Idle string `yaml:"idle"`
	} `yaml:"workers"`
	Actors struct {
		Pause   string `yaml:"pause"`
		Suspend string `yaml:"suspend"`
	} `yaml:"actors"`
	Tiers []Tier `yaml:"tiers"`
	Edge  struct {
		Mode          string `yaml:"mode"`
		Zone          string `yaml:"zone"`
		PreviewSuffix string `yaml:"previewSuffix"`
	} `yaml:"edge"`
	DNS struct {
		Provider    string            `yaml:"provider"`
		Credentials map[string]string `yaml:"credentials"`
	} `yaml:"dns"`
}

type Tier struct {
	Name    string `yaml:"name"`
	CPU     string `yaml:"cpu"`
	Memory  string `yaml:"memory"`
	Default bool   `yaml:"default"`
}

// Strict: a key the File does not have is an error, so a misspelt one is not silently ignored.
func Load(path string) (File, error) {
	var f File
	raw, err := os.ReadFile(path)
	if err != nil {
		return f, err
	}
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(&f); err != nil && !errors.Is(err, io.EOF) {
		return f, fmt.Errorf("%s: %w", path, err)
	}
	return f, nil
}

// A --tier value: name:cpu:memory, and :default for the default one.
func parseTier(s string) (Tier, error) {
	parts := strings.Split(s, ":")
	if len(parts) < 3 || len(parts) > 4 || len(parts) == 4 && parts[3] != "default" {
		return Tier{}, fmt.Errorf("--tier %q: name:cpu:memory, or name:cpu:memory:default", s)
	}
	return Tier{Name: parts[0], CPU: parts[1], Memory: parts[2], Default: len(parts) == 4}, nil
}

// The tiers as the plane holds them: the worker reserves a quarter of each tier's CPU. One tier alone is the default.
func resolve(ts []Tier) ([]sandbox.Tier, error) {
	if len(ts) == 0 {
		return sandbox.DefaultTiers, nil
	}
	var out []sandbox.Tier
	defaults, seen := 0, map[string]bool{}
	for _, t := range ts {
		if t.Name == "" || t.CPU == "" || t.Memory == "" {
			return nil, fmt.Errorf("tier %+v: name, cpu and memory are required", t)
		}
		if seen[t.Name] {
			return nil, fmt.Errorf("tier %s is declared twice", t.Name)
		}
		seen[t.Name] = true
		milli, err := millicores(t.CPU)
		if err != nil {
			return nil, fmt.Errorf("tier %s: %w", t.Name, err)
		}
		if t.Default {
			defaults++
		}
		out = append(out, sandbox.Tier{Name: t.Name, CPU: t.CPU, Memory: t.Memory, CPURequest: cores(milli / 4),
			Default: t.Default || len(ts) == 1})
	}
	if len(ts) > 1 && defaults != 1 {
		return nil, fmt.Errorf("%d tiers are marked default: exactly one is", defaults)
	}
	return out, nil
}

// "2" or "500m", in millicores.
func millicores(cpu string) (int, error) {
	if m, ok := strings.CutSuffix(cpu, "m"); ok {
		n, err := strconv.Atoi(m)
		if err != nil || n <= 0 {
			return 0, fmt.Errorf("cpu %q: cores, or millicores ending in m", cpu)
		}
		return n, nil
	}
	f, err := strconv.ParseFloat(cpu, 64)
	if err != nil || f <= 0 {
		return 0, fmt.Errorf("cpu %q: cores, or millicores ending in m", cpu)
	}
	return int(f * 1000), nil
}

func cores(milli int) string {
	if milli%1000 == 0 {
		return strconv.Itoa(milli / 1000)
	}
	return strconv.Itoa(milli) + "m"
}
