// The script that makes a node, and the cloud-init that runs it on a worker. A node registers with the providerID and
// public addresses hz gives it: the control node's from the server hz made, a worker's from the cloud's Identity.
package node

import (
	"bytes"
	_ "embed"
	"fmt"
	"sort"
	"text/template"

	"github.com/getnvoi/host0/shared/naming"
)

//go:embed k3s.sh
var script string

var tmpl = template.Must(template.New("k3s").Parse(script))

// Run on the server once its node is Ready.
//
//go:embed encrypt.sh
var Encrypt string

type params struct {
	Role, Token, Subnet, ControlIP, Registry, LocalRegistry string
	Labels                                                    []string
	// Shell that sets provider_id and external_ips.
	Identity string
}

func render(role, token string, labels map[string]string, identity string) string {
	var ls []string
	for k, v := range labels {
		ls = append(ls, k+"="+v)
	}
	sort.Strings(ls)
	var b bytes.Buffer
	_ = tmpl.Execute(&b, params{role, token, naming.Subnet, naming.ControlIP, naming.Registry, naming.LocalRegistry(), ls, identity})
	return b.String()
}

// externalIPs is comma separated, IPv4 first.
func Server(providerID, externalIPs string) string {
	return render("server", "", nil, fmt.Sprintf("provider_id=%q\nexternal_ips=%q\n", providerID, externalIPs))
}

// The labels a worker joins with; the worker pools select hz.dev/worker.
func Labels(substrateVersion string) map[string]string {
	return map[string]string{"hz.dev/worker": "true", "ate.dev/substrate-version": substrateVersion}
}

// identity is the cloud's: a worker's server id does not exist when its cloud-init is written.
func Worker(token string, labels map[string]string, identity string) string {
	var b bytes.Buffer
	b.WriteString("#cloud-config\nwrite_files:\n  - path: /root/k3s.sh\n    permissions: \"0700\"\n    content: |\n")
	for _, line := range bytes.Split([]byte(render("agent", token, labels, identity)), []byte("\n")) {
		b.WriteString("      ")
		b.Write(line)
		b.WriteString("\n")
	}
	b.WriteString("runcmd:\n  - [sh, /root/k3s.sh]\n")
	return b.String()
}
