package agents

import "testing"

func TestAll(t *testing.T) {
	all, err := All()
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]File{}
	for _, f := range all {
		names[f.Name] = f
	}
	if names["hz"].Tools["*"] != "auto" || names["careful"].Name == "" {
		t.Fatalf("agents %+v", all)
	}
}
