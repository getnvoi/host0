package client

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// client.gen.go is what oapi-codegen writes from the spec.
func TestGenerated(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "client.gen.go")
	cfg, err := os.ReadFile("oapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	cfg = bytes.Replace(cfg, []byte("output: client/client.gen.go"), []byte("output: "+out), 1)
	if err := os.WriteFile(filepath.Join(dir, "oapi.yaml"), cfg, 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "tool", "oapi-codegen", "-config", filepath.Join(dir, "oapi.yaml"), "openapi.yaml")
	cmd.Dir = ".."
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("oapi-codegen: %v: %s", err, b)
	}
	want, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("client.gen.go")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("client.gen.go is not what the spec makes: go generate ./internal/api")
	}
}
