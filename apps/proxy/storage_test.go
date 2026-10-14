package main

import (
	"context"
	"errors"
	"io/fs"
	"maps"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"
)

// A Secret as the apiserver keeps it: every write bumps the version, and a write at an older one is refused.
type memSecret struct {
	mu      sync.Mutex
	data    map[string][]byte
	version int
	writes  int
}

func (m *memSecret) get(context.Context) (map[string][]byte, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return maps.Clone(m.data), strconv.Itoa(m.version), nil
}

func (m *memSecret) put(_ context.Context, data map[string][]byte, version string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if version != strconv.Itoa(m.version) {
		return errConflict
	}
	m.data, m.version = maps.Clone(data), m.version+1
	m.writes++
	return nil
}

func TestStorage(t *testing.T) {
	ctx := context.Background()
	s := newKubeStorage(&memSecret{})
	keys := []string{
		"acme/acme-v02.api.letsencrypt.org-directory/users/default/default.json",
		"certificates/acme-v02.api.letsencrypt.org-directory/wildcard_.nvoi.to/wildcard_.nvoi.to.crt",
		"certificates/acme-v02.api.letsencrypt.org-directory/wildcard_.nvoi.to/wildcard_.nvoi.to.key",
	}
	for _, k := range keys {
		if err := s.Store(ctx, k, []byte("value of "+k)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Load(ctx, keys[1])
	if err != nil || string(got) != "value of "+keys[1] {
		t.Fatalf("load %q %v", got, err)
	}
	if _, err := s.Load(ctx, "certificates/none"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("load of a missing key: %v", err)
	}
	if !s.Exists(ctx, keys[0]) || !s.Exists(ctx, "certificates") || s.Exists(ctx, "certs") {
		t.Fatal("exists")
	}
	info, err := s.Stat(ctx, keys[2])
	if err != nil || !info.IsTerminal || info.Size != int64(len("value of "+keys[2])) || info.Modified.IsZero() {
		t.Fatalf("stat %+v %v", info, err)
	}
	if info, err := s.Stat(ctx, "certificates"); err != nil || info.IsTerminal {
		t.Fatalf("stat of a directory %+v %v", info, err)
	}

	top, err := s.List(ctx, "certificates", false)
	if err != nil || !slices.Equal(top, []string{"certificates/acme-v02.api.letsencrypt.org-directory"}) {
		t.Fatalf("list %v %v", top, err)
	}
	all, err := s.List(ctx, "certificates", true)
	want := []string{
		"certificates/acme-v02.api.letsencrypt.org-directory",
		"certificates/acme-v02.api.letsencrypt.org-directory/wildcard_.nvoi.to",
		keys[1], keys[2],
	}
	if err != nil || !slices.Equal(all, want) {
		t.Fatalf("recursive list %v %v", all, err)
	}

	if err := s.Delete(ctx, "certificates"); err != nil {
		t.Fatal(err)
	}
	if s.Exists(ctx, keys[1]) || !s.Exists(ctx, keys[0]) {
		t.Fatal("delete of a directory took the wrong keys")
	}
	if err := s.Delete(ctx, "certificates/none"); err != nil {
		t.Fatalf("delete of a missing key: %v", err)
	}
	if _, err := s.List(ctx, "certificates", true); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("list of an empty prefix: %v", err)
	}
}

// Two writers on one Secret: each write is redone on top of the other's, and none is lost.
func TestStorageConcurrentWrites(t *testing.T) {
	ctx := context.Background()
	secret := &memSecret{}
	a, b := newKubeStorage(secret), newKubeStorage(secret)
	var wg sync.WaitGroup
	for i := range 3 {
		wg.Add(2)
		go func() { defer wg.Done(); a.Store(ctx, "a/"+strconv.Itoa(i), []byte("a")) }()
		go func() { defer wg.Done(); b.Store(ctx, "b/"+strconv.Itoa(i), []byte("b")) }()
	}
	wg.Wait()
	for i := range 3 {
		if !a.Exists(ctx, "a/"+strconv.Itoa(i)) || !a.Exists(ctx, "b/"+strconv.Itoa(i)) {
			t.Fatalf("a write was lost: %v", secret.data)
		}
	}
}

func TestLock(t *testing.T) {
	ctx := context.Background()
	secret := &memSecret{}
	a, b := newKubeStorage(secret), newKubeStorage(secret)
	for _, s := range []*kubeStorage{a, b} {
		s.poll, s.renew, s.stale = 5*time.Millisecond, 20*time.Millisecond, 200*time.Millisecond
	}
	if err := a.Lock(ctx, "issue_cert_*.nvoi.to"); err != nil {
		t.Fatal(err)
	}
	// b waits while a holds and renews, past the time a lock goes stale.
	short, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
	defer cancel()
	if err := b.Lock(short, "issue_cert_*.nvoi.to"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("b took a held lock: %v", err)
	}
	if err := b.Unlock(ctx, "issue_cert_*.nvoi.to"); err == nil {
		t.Fatal("b released a's lock")
	}
	if err := a.Unlock(ctx, "issue_cert_*.nvoi.to"); err != nil {
		t.Fatal(err)
	}
	if err := b.Lock(ctx, "issue_cert_*.nvoi.to"); err != nil {
		t.Fatal(err)
	}
	if err := b.Unlock(ctx, "issue_cert_*.nvoi.to"); err != nil {
		t.Fatal(err)
	}
}

// A holder that died stops renewing; its lock is taken once stale.
func TestLockStale(t *testing.T) {
	ctx := context.Background()
	secret := &memSecret{}
	dead, b := newKubeStorage(secret), newKubeStorage(secret)
	b.poll, b.stale = 5*time.Millisecond, 50*time.Millisecond
	if won, err := dead.take(ctx, "x"); err != nil || !won {
		t.Fatalf("take %v %v", won, err)
	}
	start := time.Now()
	if err := b.Lock(ctx, "x"); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) < 40*time.Millisecond {
		t.Fatal("a fresh lock was taken over")
	}
	b.Unlock(ctx, "x")
}
