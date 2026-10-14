package steps

import (
	"context"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/shared/naming"
	"github.com/getnvoi/host0/shared/seal"
	"github.com/getnvoi/host0/shared/state"
)

// The control node's kubectl: answers a secret's data from secrets, records what is applied.
type shell struct {
	secrets map[string]string
	applied []string
}

func (s *shell) Run(_ context.Context, cmd string, stdin io.Reader, out io.Writer) error {
	if strings.Contains(cmd, "apply") {
		b, _ := io.ReadAll(stdin)
		s.applied = append(s.applied, string(b))
		return nil
	}
	for name, data := range s.secrets {
		if strings.Contains(cmd, "get secret "+name+" ") {
			io.WriteString(out, data)
		}
	}
	return nil
}

func (*shell) Forward(context.Context, string, string) (func(), error) { return func() {}, nil }

type edge struct{ infra.Edge }

func (edge) Deployment() string { return proxy }

func (edge) Reach(context.Context) error { return nil }

func (edge) Records(context.Context, naming.Cluster) ([]string, error) { return nil, nil }

func TestCertificatesBeforeEdge(t *testing.T) {
	var names []string
	for _, s := range Install {
		names = append(names, s.Name)
	}
	if slices.Index(names, "certificates") > slices.Index(names, "edge") || slices.Index(names, "certificates") < 0 {
		t.Fatalf("certificates does not run before edge: %v", names)
	}
	names = nil
	for _, s := range Local {
		names = append(names, s.Name)
	}
	if slices.Index(names, "certificates") > slices.Index(names, "edge") || slices.Index(names, "certificates") < 0 {
		t.Fatalf("local: certificates does not run before edge: %v", names)
	}
}

func TestCertificatesRestore(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	ctx := context.Background()
	e := &infra.Env{Edge: edge{}, Config: infra.Config{Zone: "nvoi.to"}, Out: io.Discard}

	// No saved file: an empty secret for the proxy to fill.
	sh := &shell{}
	e.Shell = sh
	if err := certificates(ctx, e); err != nil {
		t.Fatal(err)
	}
	if len(sh.applied) != 1 || !strings.Contains(sh.applied[0], "name: "+naming.Certs) {
		t.Fatalf("applied %v", sh.applied)
	}

	// A saved file: restored into the secret.
	key := seal.Mint()
	if err := state.SaveKey(key); err != nil {
		t.Fatal(err)
	}
	if err := state.SaveCerts("nvoi.to", key, map[string][]byte{"k.YQ": []byte("cert")}); err != nil {
		t.Fatal(err)
	}
	sh = &shell{}
	e.Shell = sh
	if err := certificates(ctx, e); err != nil {
		t.Fatal(err)
	}
	if len(sh.applied) != 1 || !strings.Contains(sh.applied[0], "k.YQ: "+base64.StdEncoding.EncodeToString([]byte("cert"))) {
		t.Fatalf("applied %v", sh.applied)
	}

	// The cluster has its own: left alone.
	sh = &shell{secrets: map[string]string{naming.Certs: `{"k.Yg":"` + base64.StdEncoding.EncodeToString([]byte("own")) + `"}`}}
	e.Shell = sh
	if err := certificates(ctx, e); err != nil || len(sh.applied) != 0 {
		t.Fatalf("replaced the cluster's own: %v %v", sh.applied, err)
	}

	// A saved file that does not open is an error.
	if err := state.SaveKey(seal.Mint()); err != nil {
		t.Fatal(err)
	}
	e.Shell = &shell{}
	if err := certificates(ctx, e); err == nil || !strings.Contains(err.Error(), filepath.Join(".hz", "certs", "nvoi.to")) {
		t.Fatalf("a file that does not open: %v", err)
	}
	os.Remove(state.KeyPath())
	if err := certificates(ctx, e); err == nil || !strings.Contains(err.Error(), "which is not there") {
		t.Fatalf("a file without its key: %v", err)
	}
}
