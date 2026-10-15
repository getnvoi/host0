package main

import (
	"bytes"
	"os"
	"testing"
)

// cmd/h0/remote/commands.gen.go is what this generator writes from the spec.
func TestCommandsCurrent(t *testing.T) {
	raw, err := os.ReadFile("../openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	want, err := Generate(raw)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("../../../cmd/h0/remote/commands.gen.go")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("cmd/h0/remote/commands.gen.go is not what the spec makes: go generate ./internal/api")
	}
}

// Words names a string query parameter, which is then an argument and not a flag.
func TestWords(t *testing.T) {
	op := func(words, typ string) []byte {
		return []byte(`paths: {/search: {get: {operationId: search, parameters: [{name: q, in: query, schema: {type: ` + typ +
			`}}], x-h0: {output: table, words: ` + words + `}}}}`)
	}
	src, err := Generate(op("q", "string"))
	if err != nil || !bytes.Contains(src, []byte(`Words: "q"`)) || bytes.Contains(src, []byte(`Query:`)) {
		t.Fatalf("%v\n%s", err, src)
	}
	for _, bad := range [][]byte{op("text", "string"), op("q", "integer")} {
		if _, err := Generate(bad); err == nil {
			t.Errorf("%s: generated", bad)
		}
	}
}

func TestCamel(t *testing.T) {
	for id, want := range map[string]string{"me": "Me", "session.queue.rm": "SessionQueueRm", "env.seed-state": "EnvSeedState"} {
		if got := camel(id); got != want {
			t.Errorf("%s: %s, want %s", id, got, want)
		}
	}
}
