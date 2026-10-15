package steps

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/edge"
	"github.com/getnvoi/host0/internal/infra"
	"github.com/getnvoi/host0/internal/shared/naming"
	"github.com/getnvoi/host0/internal/shared/seal"
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

type public struct{ edge.Edge }

func (public) Deployment() string { return proxy }

func (public) Reach(context.Context) error { return nil }

func (public) Records(context.Context, naming.Cluster) ([]string, error) { return nil, nil }

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
	ctx := context.Background()
	l := &laptop{certs: map[string]map[string][]byte{}, under: map[string][]byte{}}
	e := &infra.Env{Edge: public{}, Config: infra.Config{Zone: "nvoi.to"}, Laptop: l, Out: io.Discard}

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
	if err := l.SaveKey(key); err != nil {
		t.Fatal(err)
	}
	if err := l.SaveCerts("nvoi.to", key, map[string][]byte{"k.YQ": []byte("cert")}); err != nil {
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

	// Kept certificates that do not open stop the install, with the laptop's reason.
	if err := l.SaveKey(seal.Mint()); err != nil {
		t.Fatal(err)
	}
	e.Shell = &shell{}
	if err := certificates(ctx, e); err == nil || !strings.Contains(err.Error(), "~/.h0/certs/nvoi.to") {
		t.Fatalf("certificates that do not open: %v", err)
	}
}

// The laptop's files in memory: a key, and certificates kept per zone under it.
type laptop struct {
	key   []byte
	certs map[string]map[string][]byte
	under map[string][]byte
}

func (l *laptop) Key() ([]byte, error)           { return l.key, nil }
func (l *laptop) SaveKey(k []byte) error         { l.key = k; return nil }
func (l *laptop) KeyPath() string                { return "~/.h0/key" }
func (l *laptop) CertsPath(z string) string      { return "~/.h0/certs/" + z }
func (l *laptop) SavePlane(string, string) error { return nil }

func (l *laptop) SaveCerts(zone string, key []byte, data map[string][]byte) error {
	l.certs[zone], l.under[zone] = data, key
	return nil
}

func (l *laptop) Certs(zone string) (map[string][]byte, error) {
	if l.certs[zone] != nil && !bytes.Equal(l.under[zone], l.key) {
		return nil, fmt.Errorf("%s: %w", l.CertsPath(zone), seal.ErrOpen)
	}
	return l.certs[zone], nil
}

type gone struct{ cloud.Cloud }

func (gone) List(context.Context, naming.Cluster) ([]cloud.Server, error) { return nil, nil }

// A destroyed cluster has nothing to keep, so a second destroy with --keep-cert goes on to its no-op sweep.
func TestKeepCertsWithoutControl(t *testing.T) {
	l := &laptop{key: make([]byte, seal.Size)}
	e := &infra.Env{Cluster: naming.Cluster{Name: "edge"}, Cloud: gone{}, Edge: public{}, Config: infra.Config{Zone: "nvoi.to"},
		Laptop: l, Out: io.Discard}
	if err := KeepCerts(context.Background(), e); err != nil {
		t.Fatal(err)
	}
}
