// plane.Store as one file per record under a directory on the control node's disk, each record's JSON sealed
// whole with the sealing key.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/getnvoi/host0/plane"
	"github.com/getnvoi/host0/shared/seal"
)

type Files struct {
	Root string
	Key  []byte
	mu   sync.Mutex
}

var _ plane.Store = (*Files)(nil)

// A file at the root, sealed under the key every record is sealed with.
const marker = "sealed"

// The store at root under key. A root without the marker holds no sealed record, and whatever is there is removed.
// A marker that does not open means another key sealed this store: nothing is read or removed.
func Open(root string, key []byte) (*Files, error) {
	f := &Files{Root: root, Key: key}
	m := filepath.Join(root, marker)
	b, err := os.ReadFile(m)
	if err == nil {
		if _, err := seal.Open(key, b); err != nil {
			return nil, fmt.Errorf("%s: %w", m, err)
		}
		return f, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	for _, e := range entries {
		log.Printf("store: %s has no sealing marker: removing %s", root, e.Name())
		if err := os.RemoveAll(filepath.Join(root, e.Name())); err != nil {
			return nil, err
		}
	}
	sealed, err := seal.Seal(key, []byte(marker))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	if err := write(m, sealed); err != nil {
		return nil, err
	}
	return f, flush(root)
}

func (f *Files) path(kind, id string) string { return filepath.Join(f.Root, kind, id+".json") }

func (f *Files) Get(kind, id string, v any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, err := os.ReadFile(f.path(kind, id))
	if errors.Is(err, fs.ErrNotExist) {
		return plane.ErrNotFound
	}
	if err != nil {
		return err
	}
	plain, err := seal.Open(f.Key, b)
	if err != nil {
		return fmt.Errorf("store %s/%s: %w", kind, id, err)
	}
	return json.Unmarshal(plain, v)
}

func (f *Files) Put(kind, id string, v any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	plain, err := json.Marshal(v)
	if err != nil {
		return err
	}
	b, err := seal.Seal(f.Key, plain)
	if err != nil {
		return err
	}
	p := f.path(kind, id)
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	// Written, synced, renamed, and the rename synced: a crash leaves the old record or the new one, whole.
	if err := write(p+".tmp", b); err != nil {
		return err
	}
	if err := os.Rename(p+".tmp", p); err != nil {
		return err
	}
	return flush(filepath.Dir(p))
}

func write(path string, b []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func flush(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func (f *Files) Delete(kind, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	err := os.Remove(f.path(kind, id))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (f *Files) List(kind string, each func(decode func(any) error) error) error {
	f.mu.Lock()
	// An id may hold a slash (usage is <day>/<session>), so the kind's directory is walked, not globbed.
	var paths []string
	filepath.WalkDir(filepath.Join(f.Root, kind), func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".json") {
			paths = append(paths, p)
		}
		return nil
	})
	sort.Strings(paths)
	var blobs [][]byte
	var names []string
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			log.Printf("store: skip %s: %v", p, err)
			continue
		}
		// A record that does not open fails the list: under a wrong key every record would, and the list is not empty.
		plain, err := seal.Open(f.Key, b)
		if err != nil {
			f.mu.Unlock()
			return fmt.Errorf("store %s: %w", p, err)
		}
		blobs, names = append(blobs, plain), append(names, p)
	}
	f.mu.Unlock()
	// A record that does not decode is skipped and logged: one bad file does not hide the rest.
	for i, b := range blobs {
		var bad error
		err := each(func(v any) error {
			if err := json.Unmarshal(b, v); err != nil {
				bad = err
				return err
			}
			return nil
		})
		if bad != nil {
			log.Printf("store: skip %s: %v", names[i], bad)
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}
