package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/caddyserver/certmagic"
)

// One Secret's data, read with the version it was read at; a write at a stale version is errConflict.
type secret interface {
	get(ctx context.Context) (data map[string][]byte, version string, err error)
	put(ctx context.Context, data map[string][]byte, version string) error
}

var errConflict = errors.New("the secret changed since it was read")

// certmagic.Storage in one Secret: the ACME account and the certificates go with the cluster, not with a node's disk.
// A key is "k." + base64url(name); a lock is "l." + base64url(name), held while its holder renews it.
type kubeStorage struct {
	secret secret
	id     string // this process, in the locks it holds
	mu     sync.Mutex
	held   map[string]context.CancelFunc
	// A lock not renewed for stale is taken over; it is renewed every renew.
	stale, renew, poll time.Duration
}

var _ certmagic.Storage = (*kubeStorage)(nil)

type stored struct {
	Value    []byte    `json:"v"`
	Modified time.Time `json:"at"`
}

type lock struct {
	Holder string    `json:"holder"`
	At     time.Time `json:"at"`
}

func newKubeStorage(s secret) *kubeStorage {
	b := make([]byte, 8)
	rand.Read(b)
	return &kubeStorage{secret: s, id: hex.EncodeToString(b), held: map[string]context.CancelFunc{},
		stale: time.Minute, renew: 10 * time.Second, poll: time.Second}
}

func dataKey(name string) string { return "k." + base64.RawURLEncoding.EncodeToString([]byte(name)) }
func lockKey(name string) string { return "l." + base64.RawURLEncoding.EncodeToString([]byte(name)) }

// Reads, changes and writes the secret at the version read; a write that lost a race is redone, eight times at most.
func (s *kubeStorage) update(ctx context.Context, change func(map[string][]byte) error) error {
	for range 8 {
		data, version, err := s.secret.get(ctx)
		if err != nil {
			return err
		}
		if data == nil {
			data = map[string][]byte{}
		}
		if err := change(data); err != nil {
			return err
		}
		err = s.secret.put(ctx, data, version)
		if !errors.Is(err, errConflict) {
			return err
		}
	}
	return fmt.Errorf("certificate storage: eight writes lost to concurrent ones")
}

func (s *kubeStorage) entries(ctx context.Context) (map[string]stored, error) {
	data, _, err := s.secret.get(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]stored{}
	for k, v := range data {
		if !strings.HasPrefix(k, "k.") {
			continue
		}
		name, err := base64.RawURLEncoding.DecodeString(k[2:])
		if err != nil {
			return nil, fmt.Errorf("certificate storage key %s: %w", k, err)
		}
		var e stored
		if err := json.Unmarshal(v, &e); err != nil {
			return nil, fmt.Errorf("certificate storage %s: %w", name, err)
		}
		out[string(name)] = e
	}
	return out, nil
}

func (s *kubeStorage) Store(ctx context.Context, key string, value []byte) error {
	raw, _ := json.Marshal(stored{Value: value, Modified: time.Now().UTC()})
	return s.update(ctx, func(d map[string][]byte) error { d[dataKey(key)] = raw; return nil })
}

func (s *kubeStorage) Load(ctx context.Context, key string) ([]byte, error) {
	es, err := s.entries(ctx)
	if err != nil {
		return nil, err
	}
	e, ok := es[key]
	if !ok {
		return nil, fmt.Errorf("%s: %w", key, fs.ErrNotExist)
	}
	return e.Value, nil
}

func under(key, prefix string) bool {
	return prefix == "" || key == prefix || strings.HasPrefix(key, strings.TrimSuffix(prefix, "/")+"/")
}

// Deletes key and every key under it.
func (s *kubeStorage) Delete(ctx context.Context, key string) error {
	es, err := s.entries(ctx)
	if err != nil {
		return err
	}
	return s.update(ctx, func(d map[string][]byte) error {
		for name := range es {
			if under(name, key) {
				delete(d, dataKey(name))
			}
		}
		return nil
	})
}

func (s *kubeStorage) Exists(ctx context.Context, key string) bool {
	es, err := s.entries(ctx)
	if err != nil {
		return false
	}
	for name := range es {
		if under(name, key) {
			return true
		}
	}
	return false
}

// The keys under prefix, directories among them; without recursive, only its direct children.
func (s *kubeStorage) List(ctx context.Context, prefix string, recursive bool) ([]string, error) {
	es, err := s.entries(ctx)
	if err != nil {
		return nil, err
	}
	prefix = strings.TrimSuffix(prefix, "/")
	seen := map[string]bool{}
	for name := range es {
		if name == prefix || !under(name, prefix) {
			continue
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(name, prefix), "/")
		parts := strings.Split(rel, "/")
		if !recursive {
			parts = parts[:1]
		}
		for i := range parts {
			seen[path.Join(prefix, path.Join(parts[:i+1]...))] = true
		}
	}
	if len(seen) == 0 {
		return nil, fmt.Errorf("%s: %w", prefix, fs.ErrNotExist)
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys, nil
}

func (s *kubeStorage) Stat(ctx context.Context, key string) (certmagic.KeyInfo, error) {
	es, err := s.entries(ctx)
	if err != nil {
		return certmagic.KeyInfo{}, err
	}
	if e, ok := es[key]; ok {
		return certmagic.KeyInfo{Key: key, Modified: e.Modified, Size: int64(len(e.Value)), IsTerminal: true}, nil
	}
	for name := range es {
		if under(name, key) {
			return certmagic.KeyInfo{Key: key, IsTerminal: false}, nil
		}
	}
	return certmagic.KeyInfo{}, fmt.Errorf("%s: %w", key, fs.ErrNotExist)
}

// Takes name when it is free, ours already, or stale; the secret's version makes two takers race to one winner.
func (s *kubeStorage) take(ctx context.Context, name string) (bool, error) {
	won := false
	err := s.update(ctx, func(d map[string][]byte) error {
		won = false
		if raw, ok := d[lockKey(name)]; ok {
			var l lock
			if err := json.Unmarshal(raw, &l); err != nil {
				return fmt.Errorf("lock %s: %w", name, err)
			}
			if l.Holder != s.id && time.Since(l.At) < s.stale {
				return nil
			}
		}
		d[lockKey(name)], _ = json.Marshal(lock{Holder: s.id, At: time.Now().UTC()})
		won = true
		return nil
	})
	return won, err
}

func (s *kubeStorage) Lock(ctx context.Context, name string) error {
	for {
		won, err := s.take(ctx, name)
		if err != nil {
			return err
		}
		if won {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(s.poll):
		}
	}
	renewing, stop := context.WithCancel(context.Background())
	s.mu.Lock()
	s.held[name] = stop
	s.mu.Unlock()
	go func() {
		for {
			select {
			case <-renewing.Done():
				return
			case <-time.After(s.renew):
			}
			if won, err := s.take(renewing, name); renewing.Err() == nil && (err != nil || !won) {
				// Losing the lock mid-work is a fault certmagic tolerates; it is said, not hidden.
				log.Printf("lock %s: renewal failed (taken %v): %v", name, won, err)
			}
		}
	}()
	return nil
}

func (s *kubeStorage) Unlock(ctx context.Context, name string) error {
	s.mu.Lock()
	if stop, ok := s.held[name]; ok {
		stop()
		delete(s.held, name)
	}
	s.mu.Unlock()
	return s.update(ctx, func(d map[string][]byte) error {
		raw, ok := d[lockKey(name)]
		if !ok {
			return nil
		}
		var l lock
		if err := json.Unmarshal(raw, &l); err != nil {
			return fmt.Errorf("lock %s: %w", name, err)
		}
		if l.Holder != s.id {
			return fmt.Errorf("lock %s is held by %s, not this proxy", name, l.Holder)
		}
		delete(d, lockKey(name))
		return nil
	})
}
