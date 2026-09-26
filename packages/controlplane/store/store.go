// controlplane.Store as one JSON file per record, under a directory on the control node's disk.
package store

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/getnvoi/nvoi/controlplane"
)

type Files struct {
	Root string
	mu   sync.Mutex
}

var _ controlplane.Store = (*Files)(nil)

func (f *Files) path(kind, id string) string { return filepath.Join(f.Root, kind, id+".json") }

func (f *Files) Get(kind, id string, v any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, err := os.ReadFile(f.path(kind, id))
	if errors.Is(err, fs.ErrNotExist) {
		return controlplane.ErrNotFound
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func (f *Files) Put(kind, id string, v any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, err := json.MarshalIndent(v, "", "  ")
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
		blobs, names = append(blobs, b), append(names, p)
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
