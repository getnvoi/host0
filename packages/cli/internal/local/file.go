package local

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"

	"gopkg.in/yaml.v3"
)

// cluster.yml: what cluster install and destroy take as flags, in one place. A flag given overrides the file.
// credentials map a provider's own key to the shell variable holding its value; no value is ever in the file.
type File struct {
	Name  string `yaml:"name"`
	Cloud struct {
		Provider    string            `yaml:"provider"`
		Location    string            `yaml:"location"`
		Control     string            `yaml:"control"`
		Worker      string            `yaml:"worker"`
		WorkerMax   int               `yaml:"workerMax"`
		Credentials map[string]string `yaml:"credentials"`
	} `yaml:"cloud"`
	Edge struct {
		Mode          string `yaml:"mode"`
		Zone          string `yaml:"zone"`
		PreviewSuffix string `yaml:"previewSuffix"`
	} `yaml:"edge"`
	DNS struct {
		Provider    string            `yaml:"provider"`
		Credentials map[string]string `yaml:"credentials"`
	} `yaml:"dns"`
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
