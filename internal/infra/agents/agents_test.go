package agents

import (
	"os"
	"strings"
	"testing"
)

func TestAll(t *testing.T) {
	all, err := All()
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]File{}
	for _, f := range all {
		names[f.Name] = f
	}
	if names["hz"].Tools["*"] != "auto" || names["careful"].Name == "" || names["gitops"].Tools["*"] != "" ||
		names["gitops"].Tools["session_pr"] != "approval" {
		t.Fatalf("agents %+v", all)
	}
}

// A rule names a tool the plane serves: an operation id of its spec, dots as underscores.
func TestRulesNameTools(t *testing.T) {
	spec, err := os.ReadFile("../../api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	all, err := All()
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range all {
		for tool := range f.Tools {
			if tool != "*" && !strings.Contains(string(spec), "operationId: "+strings.ReplaceAll(tool, "_", ".")+"\n") {
				t.Errorf("%s: no operation %s", f.Name, tool)
			}
		}
	}
}
