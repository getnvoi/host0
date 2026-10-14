package hetzner

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"text/template"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/shared/naming"
)

//go:embed autoscaler.yaml
var manifest string

var tmpl = template.Must(template.New("").Delims("[[", "]]").Parse(manifest))

// The cluster-autoscaler, and the Secret it reads: workers boot with init, carry labels and the owner label.
func (h Client) Autoscaler(c naming.Cluster, max int, workerType, location, init string, labels map[string]string) (string, error) {
	config, err := json.Marshal(map[string]any{
		"imagesForArch": map[string]string{"amd64": "ubuntu-24.04"},
		"nodeConfigs": map[string]any{"workers": map[string]any{
			"cloudInit":    init,
			"labels":       labels,
			"serverLabels": cloud.Owner(c),
			"taints":       []map[string]string{{"key": naming.WorkerTaint, "value": "gvisor", "effect": "NoSchedule"}},
		}},
	})
	if err != nil {
		return "", err
	}
	var b bytes.Buffer
	b.WriteString(cloud.Secret("kube-system", "hcloud", map[string]string{
		"token":          h.token,
		"cluster-config": base64.StdEncoding.EncodeToString(config),
	}))
	b.WriteString("---\n")
	data := map[string]any{"WorkerMax": max, "WorkerType": workerType, "Location": location, "Prefix": c.Prefix()}
	if err := tmpl.Execute(&b, data); err != nil {
		return "", err
	}
	return b.String(), nil
}
