package controlplane

import (
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/getnvoi/nvoi/shared/contract"
)

func TestChanges(t *testing.T) {
	out, err := os.ReadFile("testdata/changes.bin")
	if err != nil {
		t.Fatal(err)
	}
	c, ok := changes(out)
	if !ok {
		t.Fatal("not parsed")
	}
	want := []contract.FileChange{
		{Path: "fresh.txt", Status: "added", Added: 2},
		{Path: "gone.txt", Status: "deleted", Removed: 1},
		{Path: "keep.txt", Status: "modified", Added: 2, Removed: 1},
		{Path: "new.txt", OldPath: "old.txt", Status: "renamed", Added: 1},
		{Path: "pic.bin", Status: "modified", Binary: true},
	}
	if !reflect.DeepEqual(c.Files, want) {
		t.Fatalf("files %+v", c.Files)
	}
	if c.Base != "origin/main" || c.Added != 5 || c.Removed != 2 || c.Truncated {
		t.Fatalf("got %+v", c)
	}
	if !strings.HasPrefix(c.Patch, "diff --git a/fresh.txt b/fresh.txt\n") || !strings.HasSuffix(c.Patch, "differ\n") {
		t.Fatalf("patch %q", c.Patch)
	}
	if _, ok := changes([]byte("fatal: not a git repository\n")); ok {
		t.Fatal("an error read as changes")
	}
}
