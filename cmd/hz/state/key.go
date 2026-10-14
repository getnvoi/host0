package state

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/getnvoi/host0/internal/shared/seal"
)

// ~/.hz/key: the sealing key, 32 raw bytes. It outlives every cluster: it is the backup.
func KeyPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".hz", "key")
}

// Nil, without an error, when there is no key file.
func Key() ([]byte, error) {
	b, err := os.ReadFile(KeyPath())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(b) != seal.Size {
		return nil, fmt.Errorf("%s is %d bytes, not %d", KeyPath(), len(b), seal.Size)
	}
	return b, nil
}

func SaveKey(k []byte) error {
	if err := os.MkdirAll(filepath.Dir(KeyPath()), 0o700); err != nil {
		return err
	}
	return os.WriteFile(KeyPath(), k, 0o600)
}
