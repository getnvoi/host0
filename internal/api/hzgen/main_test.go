package main

import (
	"bytes"
	"os"
	"testing"
)

// cmd/hz/remote/commands.gen.go is what this generator writes from the spec.
func TestCommandsCurrent(t *testing.T) {
	raw, err := os.ReadFile("../openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	want, err := Generate(raw)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("../../../cmd/hz/remote/commands.gen.go")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("cmd/hz/remote/commands.gen.go is not what the spec makes: go generate ./internal/api")
	}
}

func TestCamel(t *testing.T) {
	for id, want := range map[string]string{"me": "Me", "session.queue.rm": "SessionQueueRm", "env.seed-state": "EnvSeedState"} {
		if got := camel(id); got != want {
			t.Errorf("%s: %s, want %s", id, got, want)
		}
	}
}
