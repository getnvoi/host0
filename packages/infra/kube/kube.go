// kubectl on the control node, fed on stdin: no kubeconfig leaves the node, no secret is on a command line.
package kube

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/getnvoi/host0/infra"
)

const kubectl = "k3s kubectl "

func Apply(ctx context.Context, sh infra.Shell, manifest string, out io.Writer) error {
	return sh.Run(ctx, kubectl+"apply --server-side --force-conflicts -f -", strings.NewReader(manifest), out)
}

func Run(ctx context.Context, sh infra.Shell, args string, out io.Writer) error {
	return sh.Run(ctx, kubectl+args, nil, out)
}

func Output(ctx context.Context, sh infra.Shell, args string) (string, error) {
	var b bytes.Buffer
	err := sh.Run(ctx, kubectl+args, nil, &b)
	return strings.TrimSpace(b.String()), err
}

func Rollout(ctx context.Context, sh infra.Shell, ns, kind, name string, out io.Writer) error {
	return Run(ctx, sh, fmt.Sprintf("-n %s rollout status %s/%s --timeout=600s", ns, kind, name), out)
}

func Secret(ns, name string, data map[string]string) string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	fmt.Fprintf(&b, "apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\ndata:\n", name, ns)
	for _, k := range keys {
		fmt.Fprintf(&b, "  %s: %s\n", k, base64.StdEncoding.EncodeToString([]byte(data[k])))
	}
	return b.String()
}
