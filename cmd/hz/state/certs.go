package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/getnvoi/host0/internal/shared/seal"
)

// ~/.hz/certs/<zone>: the public edge's certificate Secret, kept by `hz cluster destroy --keep-cert`, sealed with
// ~/.hz/key. A development aid: a cluster made again for a zone reuses its certificate instead of asking for another.
func CertsPath(zone string) string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".hz", "certs", zone)
}

func SaveCerts(zone string, key []byte, data map[string][]byte) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	sealed, err := seal.Seal(key, raw)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(CertsPath(zone)), 0o700); err != nil {
		return err
	}
	return os.WriteFile(CertsPath(zone), sealed, 0o600)
}

// Nil, without an error, when there is no file; a file that does not open is an error naming it.
func Certs(zone string, key []byte) (map[string][]byte, error) {
	b, err := os.ReadFile(CertsPath(zone))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	raw, err := seal.Open(key, b)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", CertsPath(zone), err)
	}
	var data map[string][]byte
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("%s: %w", CertsPath(zone), err)
	}
	return data, nil
}
