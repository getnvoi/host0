// ~/.nvoi/state.json: where the plane is and the token it takes. The only thing the laptop keeps.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type State struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func path() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".nvoi", "state.json")
}

func Save(s State) error {
	if err := os.MkdirAll(filepath.Dir(path()), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(path(), b, 0o600)
}

func Load() (State, error) {
	var s State
	b, err := os.ReadFile(path())
	if err != nil {
		return s, fmt.Errorf("no plane: run nvoi cluster install (%w)", err)
	}
	return s, json.Unmarshal(b, &s)
}
