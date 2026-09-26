package controlplane

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestToolSchemas(t *testing.T) {
	b, _ := json.Marshal(Tools)
	if strings.Contains(string(b), "null") {
		t.Fatalf("a schema carries null: %s", b)
	}
}
