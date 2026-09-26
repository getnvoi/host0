package hetzner

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"text/template"

	"github.com/getnvoi/nvoi/infra"
	"github.com/getnvoi/nvoi/infra/kube"
	"github.com/getnvoi/nvoi/shared/naming"
)

//go:embed addons/*.yaml
var addons embed.FS

var tmpl = template.Must(template.New("").Delims("[[", "]]").ParseFS(addons, "addons/*.yaml"))

// The cloud controller and the autoscaler, with the secret both read.
func (h Client) Addons(c naming.Cluster, cfg infra.Config, workerInit string, labels map[string]string) (string, error) {
	config, err := json.Marshal(map[string]any{
		"imagesForArch": map[string]string{"amd64": "ubuntu-24.04"},
		"nodeConfigs": map[string]any{"workers": map[string]any{
			"cloudInit":    workerInit,
			"labels":       labels,
			"serverLabels": c.Labels(),
			"taints":       []map[string]string{{"key": infra.WorkerTaint, "value": "gvisor", "effect": "NoSchedule"}},
		}},
	})
	if err != nil {
		return "", err
	}
	var b bytes.Buffer
	b.WriteString(kube.Secret("kube-system", "hcloud", map[string]string{
		"token":          h.Token,
		"network":        c.Prefix(),
		"cluster-config": base64.StdEncoding.EncodeToString(config),
	}))
	data := map[string]any{"WorkerMax": cfg.WorkerMax, "WorkerType": cfg.WorkerType, "Location": cfg.Location, "Prefix": c.Prefix()}
	for _, name := range []string{"ccm.yaml", "autoscaler.yaml"} {
		b.WriteString("---\n")
		if err := tmpl.ExecuteTemplate(&b, name, data); err != nil {
			return "", err
		}
	}
	return b.String(), nil
}

func (Client) Defaults() infra.Config {
	// ccx23 for both: a new project allows 8 dedicated cores, which is one control node and one worker.
	return infra.Config{Location: "fsn1", ControlType: "ccx23", WorkerType: "ccx23"}
}
