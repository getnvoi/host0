package manifests

import (
	"strings"
	"testing"
)

func TestRenderAll(t *testing.T) {
	pools := map[string]any{"Pools": []map[string]any{
		{"Name": "hz-medium", "Namespace": "hz", "CPU": "2", "Memory": "4Gi", "CPURequest": "500m", "Replicas": 0},
		{"Name": "hz-large", "Namespace": "hz", "CPU": "4", "Memory": "8Gi", "CPURequest": "1", "Replicas": 2}}}
	data := map[string]any{
		"namespace.yaml": nil, "cloudflared.yaml": nil,
		"registry.yaml":    map[string]string{"Registry": "10.0.1.2:5001"},
		"workerpools.yaml": pools,
	}
	for name, d := range data {
		out, err := Render(name, d)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if strings.Contains(out, "<no value>") || strings.TrimSpace(out) == "" {
			t.Errorf("%s rendered empty or with missing values", name)
		}
	}
}
