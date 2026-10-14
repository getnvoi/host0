package store

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getnvoi/host0/controlplane"
	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/seal"
)

func open(t *testing.T) *Files {
	f, err := Open(t.TempDir(), seal.Mint())
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestListNested(t *testing.T) {
	f := open(t)
	f.Put("usage", "2026-09-25/a", 1)
	f.Put("usage", "2026-09-25/seed:web", 2)
	f.Put("usage", "2026-09-26/a", 3)
	var got []int
	f.List("usage", func(d func(any) error) error {
		var n int
		d(&n)
		got = append(got, n)
		return nil
	})
	if len(got) != 3 || got[0] != 1 || got[2] != 3 {
		t.Fatalf("listed %v", got)
	}
	var n int
	if err := f.Get("usage", "2026-09-25/seed:web", &n); err != nil || n != 2 {
		t.Fatalf("get %d %v", n, err)
	}
}

func TestListSkipsBadRecords(t *testing.T) {
	f := open(t)
	f.Put("things", "a", 1)
	f.Put("things", "b", "not a number")
	f.Put("things", "c", 3)
	var got []int
	err := f.List("things", func(d func(any) error) error {
		var n int
		if err := d(&n); err != nil {
			return err
		}
		got = append(got, n)
		return nil
	})
	if err != nil || len(got) != 2 || got[0] != 1 || got[1] != 3 {
		t.Fatalf("listed %v %v", got, err)
	}
}

// Every kind the plane writes a credential into: no value is on disk as written.
func TestNoPlaintextOnDisk(t *testing.T) {
	f := open(t)
	secrets := []string{"ghp_github_token_value", "sk-ant-llm-key-value", "postgres-password-value"}
	f.Put("credentials", "default", contract.Credentials{GitHub: secrets[0]})
	f.Put("llm", "main", contract.LLMConfig{Name: "main", Provider: "anthropic", Values: map[string]string{"api_key": secrets[1]}})
	f.Put("environments", "web", contract.Environment{Name: "web", Secrets: map[string]string{"DB": secrets[2]}})
	filepath.WalkDir(f.Root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, _ := os.ReadFile(p)
		for _, s := range append(secrets, "github", "api_key", "secrets") {
			if strings.Contains(string(b), s) {
				t.Errorf("%s holds %q in the clear", p, s)
			}
		}
		return nil
	})
	var c contract.Credentials
	if err := f.Get("credentials", "default", &c); err != nil || c.GitHub != secrets[0] {
		t.Fatalf("read back %+v %v", c, err)
	}
}

func TestWrongKey(t *testing.T) {
	f := open(t)
	f.Put("credentials", "default", contract.Credentials{GitHub: "x"})
	if _, err := Open(f.Root, seal.Mint()); err == nil || !strings.Contains(err.Error(), marker) {
		t.Fatalf("store opened under another key: %v", err)
	}
	other := &Files{Root: f.Root, Key: seal.Mint()}
	var c contract.Credentials
	err := other.Get("credentials", "default", &c)
	if !errors.Is(err, seal.ErrOpen) || !strings.Contains(err.Error(), "credentials/default") {
		t.Fatalf("get under another key: %v", err)
	}
	err = other.List("credentials", func(d func(any) error) error { return d(&c) })
	if !errors.Is(err, seal.ErrOpen) || !strings.Contains(err.Error(), "default.json") {
		t.Fatalf("list under another key: %v", err)
	}
}

func TestOpenRemovesUnsealed(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "credentials"), 0o700)
	os.WriteFile(filepath.Join(root, "credentials", "default.json"), []byte(`{"github":"ghp_plain"}`), 0o600)
	key := seal.Mint()
	f, err := Open(root, key)
	if err != nil {
		t.Fatal(err)
	}
	var c contract.Credentials
	if err := f.Get("credentials", "default", &c); !errors.Is(err, controlplane.ErrNotFound) {
		t.Fatalf("the plaintext record is still there: %+v %v", c, err)
	}
	f.Put("credentials", "default", contract.Credentials{GitHub: "kept"})
	if f, err = Open(root, key); err != nil {
		t.Fatal(err)
	}
	if err := f.Get("credentials", "default", &c); err != nil || c.GitHub != "kept" {
		t.Fatalf("reopened store lost its record: %+v %v", c, err)
	}
}
