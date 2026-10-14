// The dependency rules of CLAUDE.md, checked on every import of every package, tests included.
package layout_test

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

const module = "github.com/getnvoi/host0/"

var (
	features  = []string{"workspace", "auth", "tools", "workers", "preview", "stream", "infra"}
	contracts = []string{"sandbox", "llm", "scm", "store", "edge", "cloud", "db"}
	clients   = []string{"box", "kube", "api"}
)

// Imports the rules refuse, kept for the reason given. A test-only entry holds for the importer's tests alone.
var allowed = []exception{
	{"internal/cloud/clouds", "internal/cloud/hetzner", false,
		"the providers by name: hz and the plane both find a cloud from the name a cluster file or a Secret holds"},
	{"internal/cloud/clouds", "internal/cloud/scaleway", false,
		"the providers by name: hz and the plane both find a cloud from the name a cluster file or a Secret holds"},
	{"internal/workspace", "internal/llm/claude", true,
		"turns are tested on claude's real stream-json parsing; a runner written for the test would be a stub"},
}

type exception struct {
	from, to string
	tests    bool
	why      string
}

type pkg struct {
	ImportPath                         string
	Imports, TestImports, XTestImports []string
}

// The package's place: cmd, feature, contract, implementation, client or shared, and the top folder it is under.
func place(path string) (kind, top string) {
	parts := strings.Split(path, "/")
	switch {
	case parts[0] == "cmd":
		return "cmd", strings.Join(parts[:2], "/")
	case parts[0] != "internal" || len(parts) < 2:
		return "", ""
	}
	top = "internal/" + parts[1]
	switch {
	case parts[1] == "shared":
		return "shared", top
	case slices.Contains(features, parts[1]):
		return "feature", top
	case slices.Contains(clients, parts[1]):
		return "client", top
	case slices.Contains(contracts, parts[1]) && len(parts) == 2:
		return "contract", top
	case slices.Contains(contracts, parts[1]):
		return "implementation", top
	}
	return "", ""
}

// Why from may not import to; empty when it may.
func refused(from, to string, test bool) string {
	kind, top := place(from)
	toKind, toTop := place(to)
	inside := to == top || strings.HasPrefix(to, top+"/")
	switch {
	case kind == "":
		return "is in no place of the layout: add it to the lists in layout_test.go and to CLAUDE.md"
	case toKind == "":
		return "imports " + to + ", which is in no place of the layout"
	case toKind == "cmd" && !(kind == "cmd" && toTop == top):
		return "imports a binary's own code: nothing imports cmd/ but the binary itself"
	case toTop == "internal/infra" && !inside && from != "cmd/hz/local":
		return "imports the install: only cmd/hz/local may"
	case kind == "cmd":
		return ""
	case kind == "shared":
		return "is shared, which imports nothing of ours"
	case kind == "contract" && toKind != "shared":
		return "is a contract, which imports only shared"
	case kind == "client" && toKind != "shared" && toKind != "contract":
		return "is a client, which imports only shared and contracts"
	case kind == "feature" && !inside && toKind != "contract" && toKind != "client" && toKind != "shared":
		return "is a feature, which imports only contracts, clients and shared"
	case kind == "implementation":
		own := to == top
		sub := strings.HasPrefix(to, from+"/")
		conformance := test && to == "internal/cloud/conformance" && toTop == top
		if toKind != "shared" && !own && !sub && !conformance {
			return "is an implementation, which imports only its own contract, shared and its own subpackages"
		}
	}
	return ""
}

func TestLayout(t *testing.T) {
	cmd := exec.Command("go", "list", "-e", "-json", "./...")
	cmd.Env = append(os.Environ(), "GOWORK=off")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v: %s", err, stderr.String())
	}
	d := json.NewDecoder(bytes.NewReader(out))
	seen, used := 0, make([]bool, len(allowed))
	for {
		var p pkg
		if err := d.Decode(&p); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		from, ok := strings.CutPrefix(p.ImportPath, module)
		if !ok {
			continue
		}
		seen++
		check := func(imports []string, test bool) {
			for _, imp := range imports {
				to, ok := strings.CutPrefix(imp, module)
				if !ok || to == from {
					continue
				}
				why := refused(from, to, test)
				if why == "" {
					continue
				}
				if i := slices.IndexFunc(allowed, func(a exception) bool {
					return a.from == from && a.to == to && (!a.tests || test)
				}); i >= 0 {
					used[i] = true
					continue
				}
				where := ""
				if test {
					where = " (in its tests)"
				}
				t.Errorf("%s%s imports %s: %s %s", from, where, to, from, why)
			}
		}
		check(p.Imports, false)
		check(append(p.TestImports, p.XTestImports...), true)
	}
	if seen < 20 {
		t.Fatalf("go list named %d of our packages: %s", seen, stderr.String())
	}
	for i, a := range allowed {
		if !used[i] {
			t.Errorf("allowed %s -> %s is no longer imported: remove it", a.from, a.to)
		}
	}
}

// Each rule refuses what it names.
func TestRefused(t *testing.T) {
	for _, c := range []struct {
		from, to string
		test     bool
		want     string
	}{
		{"internal/workspace", "cmd/hz/state", false, "nothing imports cmd/"},
		{"cmd/hz/remote", "cmd/hz/state", false, ""},
		{"cmd/controlplane", "cmd/hz/state", false, "nothing imports cmd/"},
		{"internal/workspace", "internal/workers", false, "a feature"},
		{"internal/workspace", "internal/sandbox/substrate", false, "a feature"},
		{"internal/workspace", "internal/box", false, ""},
		{"internal/infra/steps", "internal/infra/kube", false, ""},
		{"internal/llm", "internal/sandbox", false, "a contract"},
		{"internal/llm/claude", "internal/sandbox", false, "an implementation"},
		{"internal/cloud/hetzner", "internal/cloud/conformance", true, ""},
		{"internal/cloud/hetzner", "internal/cloud/conformance", false, "an implementation"},
		{"internal/box", "internal/workspace", false, "a client"},
		{"internal/shared/naming", "internal/shared/seal", false, "shared"},
		{"cmd/controlplane", "internal/infra", false, "only cmd/hz/local"},
		{"cmd/hz/local", "internal/infra/steps", false, ""},
		{"internal/oddity", "internal/shared/seal", false, "no place"},
	} {
		got := refused(c.from, c.to, c.test)
		if c.want == "" && got != "" || !strings.Contains(got, c.want) {
			t.Errorf("%s -> %s: %q, want %q", c.from, c.to, got, c.want)
		}
	}
}
