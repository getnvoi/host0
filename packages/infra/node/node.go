// The script that makes a node, and the cloud-init that runs it on a worker the autoscaler creates.
package node

import (
	"bytes"
	_ "embed"
	"sort"
	"text/template"

	"github.com/getnvoi/host0/shared/naming"
)

//go:embed k3s.sh
var script string

var tmpl = template.Must(template.New("k3s").Parse(script))

type params struct {
	Role, Token, NetRange, ControlIP, Registry, LocalRegistry string
	Labels                                                    []string
}

func render(role, token string, labels map[string]string) string {
	var ls []string
	for k, v := range labels {
		ls = append(ls, k+"="+v)
	}
	sort.Strings(ls)
	var b bytes.Buffer
	_ = tmpl.Execute(&b, params{role, token, naming.NetRange, naming.ControlIP, naming.Registry, naming.LocalRegistry(), ls})
	return b.String()
}

func Server() string { return render("server", "", nil) }

// The labels a worker joins with; the autoscaler is told the same ones so it can plan for them.
func Labels(substrateVersion string) map[string]string {
	return map[string]string{"hz.dev/worker": "true", "ate.dev/substrate-version": substrateVersion}
}

func Worker(token string, labels map[string]string) string {
	var b bytes.Buffer
	b.WriteString("#cloud-config\nwrite_files:\n  - path: /root/k3s.sh\n    permissions: \"0700\"\n    content: |\n")
	for _, line := range bytes.Split([]byte(render("agent", token, labels)), []byte("\n")) {
		b.WriteString("      ")
		b.Write(line)
		b.WriteString("\n")
	}
	b.WriteString("runcmd:\n  - [sh, /root/k3s.sh]\n")
	return b.String()
}
