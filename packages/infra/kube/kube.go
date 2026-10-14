// kubectl on the control node, fed on stdin: no kubeconfig leaves the node, no secret is on a command line.
package kube

import (
	"bytes"
	"context"
	"fmt"
	"io"
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
