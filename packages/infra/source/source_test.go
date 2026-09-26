package source

import (
	"context"
	"io"
	"os"
	"os/exec"
	"testing"
)

// Needs the network; run with NVOI_CACHE set to a directory.
func TestSubstratePatches(t *testing.T) {
	cache := os.Getenv("NVOI_CACHE")
	if cache == "" {
		t.Skip("NVOI_CACHE not set")
	}
	dir, err := Substrate.Dir(context.Background(), cache, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-o", os.DevNull, "./cmd/ate-setup")
	build.Dir = dir
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("ate-setup does not build: %s", out)
	}
}
