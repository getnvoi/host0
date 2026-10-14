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
		"proxy.yaml":       map[string]string{"ControlLabel": "true", "Service": "http://plane.hz-system.svc:80"},
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

func TestPlaneEdge(t *testing.T) {
	for edge, want := range map[string]string{"cloudflared": "TUNNEL_TOKEN", "proxy": "HZ_DNS_CREDS"} {
		out, err := Render("plane.yaml", map[string]string{"Cluster": "dev", "Zone": "nvoi.to", "Suffix": "-preview",
			"ControlLabel": "true", "Secret": "x", "Edge": edge})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(out, want) || !strings.Contains(out, `value: "`+edge+`"`) {
			t.Errorf("%s: plane does not read %s", edge, want)
		}
		if !strings.Contains(out, "items: [{ key: seal, path: seal }]") || !strings.Contains(out, "mountPath: /etc/hz") {
			t.Errorf("%s: plane does not mount the sealing key", edge)
		}
	}
}
