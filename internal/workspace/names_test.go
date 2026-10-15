package workspace

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
)

// Each declared name that breaks its rule is refused as Invalid, the error naming its field.
func TestDeclaredNamesAreRefused(t *testing.T) {
	p := newWorkspace(t, &fakeSandbox{})
	ok := Environment{Name: "shop", Repo: "acme/shop", Branch: "main", Services: []Service{{Name: "web"}}}
	env(t, p, ok)
	for _, c := range []struct {
		field string
		edit  func(*Environment)
	}{
		{"name ", func(e *Environment) { e.Name = "Shop" }},
		{"name ", func(e *Environment) { e.Name = "shop-" }},
		{"name ", func(e *Environment) { e.Name = "shop;id" }},
		{"name ", func(e *Environment) { e.Name = strings.Repeat("a", 33) }},
		{"repo ", func(e *Environment) { e.Repo = "acme" }},
		{"repo ", func(e *Environment) { e.Repo = "acme/shop/x" }},
		{"repo ", func(e *Environment) { e.Repo = "-acme/shop" }},
		{"repo ", func(e *Environment) { e.Repo = "acme/$(id)" }},
		{"repo ", func(e *Environment) { e.Repo = "acme/.." }},
		{"repo ", func(e *Environment) { e.Repo = strings.Repeat("a", 40) + "/shop" }},
		{"branch ", func(e *Environment) { e.Branch = "my branch" }},
		{"branch ", func(e *Environment) { e.Branch = "it's" }},
		{"branch ", func(e *Environment) { e.Branch = `say"hi"` }},
		{"branch ", func(e *Environment) { e.Branch = "$(touch /tmp/x)" }},
		{"branch ", func(e *Environment) { e.Branch = "a`id`" }},
		{"service name ", func(e *Environment) { e.Services = []Service{{Name: "web;id"}} }},
		{"service name ", func(e *Environment) { e.Services = []Service{{Name: "Web"}} }},
	} {
		e := ok
		c.edit(&e)
		err := p.PutEnvironment(EnvironmentInput(e))
		if !errors.As(err, new(Invalid)) || !strings.HasPrefix(err.Error(), c.field) {
			t.Errorf("%+v: %v, want Invalid naming %q", e, err, c.field)
		}
	}
	if _, err := p.PatchEnvironment("shop", []byte(`{"branch":"x$(id)"}`)); !errors.As(err, new(Invalid)) ||
		!strings.HasPrefix(err.Error(), "branch ") {
		t.Errorf("patch: %v, want Invalid naming branch", err)
	}
}

func TestBranchFollowsCheckRefFormat(t *testing.T) {
	for _, b := range []string{"main", "feature/cart", "release-1.2", "v1.0.0", "user@fix", "a+b", "h0/a1b2c3d4", "a.b/c_d"} {
		if err := validBranch(b); err != nil {
			t.Errorf("%q refused: %v", b, err)
		}
	}
	for _, b := range []string{"", "a b", "a\tb", "a\x7f", "-x", "HEAD", "@", "a..b", ".a", "a/.b", "a.lock", "a/b.lock/c",
		"a/", "/a", "a//b", "a.", "a~1", "a^", "a:b", "a?", "a*", "a[b", `a\b`, "a@{1}", "a'b", `a"b`, "$(id)", "a;b", "a|b"} {
		if err := validBranch(b); err == nil {
			t.Errorf("%q accepted", b)
		}
	}
}

func TestRepoIsOwnerAndName(t *testing.T) {
	for _, r := range []string{"acme/shop", "a-b/c.d_e-f", "x/.github", strings.Repeat("a", 39) + "/" + strings.Repeat("b", 100)} {
		if err := validRepo(r); err != nil {
			t.Errorf("%q refused: %v", r, err)
		}
	}
	for _, r := range []string{"", "acme", "/shop", "acme/", "a--b/c", "acme-/shop", "acme/sh op", "acme/" + strings.Repeat("b", 101)} {
		if err := validRepo(r); err == nil {
			t.Errorf("%q accepted", r)
		}
	}
}

// A quoted value reaches the command whole, whatever it holds.
func TestQuoteReachesShWhole(t *testing.T) {
	for _, v := range []string{"", "plain", "it's", `"$(id)" ` + "`id`", "a\nb", `\'`, "'''", "$HOME; rm -rf /"} {
		out, err := exec.Command("sh", "-c", "printf %s "+quote(v)).Output()
		if err != nil || string(out) != v {
			t.Errorf("%q came out %q (%v)", v, out, err)
		}
	}
}

// The generated scripts quote every value they place, and leave the user's commands whole in a sh of their own.
func TestScriptsQuoteWhatTheyPlace(t *testing.T) {
	e := Environment{Name: "shop", Repo: "acme/shop", Branch: "feature/cart", Setup: []string{"npm ci"},
		Services: []Service{{Name: "web", Command: "echo 'up' # comment"}, {Name: "db", Command: "postgres", Early: true}}}
	script := seedScript(e, nil)
	for _, want := range []string{
		"mkdir -p '" + Home + "'\n",
		"echo '::h0-step:: unpacking acme/shop@feature/cart'\n",
		"[ -d '" + App + "/.git' ] || git clone -q --branch 'feature/cart' '" + checkoutBundle + "' '" + App + "'\n",
		"git -C '" + App + "' fetch -q '" + checkoutBundle + "' '+refs/heads/feature/cart:refs/remotes/origin/feature/cart' && " +
			"git -C '" + App + "' reset -q --hard 'refs/remotes/origin/feature/cart'\n",
		"git -C '" + App + "' remote set-url origin 'https://github.com/acme/shop'\nrm -f '" + checkoutBundle + "'\n",
		"cd '" + App + "'\n", "echo '::h0-step:: setup: npm ci'\nnpm ci\n", "touch '" + Ready + "'\n",
	} {
		if !strings.Contains(script, want) {
			t.Errorf("no %q in the seed script:\n%s", want, script)
		}
	}
	syntax(t, "the seed script", script)

	p := newWorkspace(t, &fakeSandbox{})
	cs, err := p.containers(context.Background(), e)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"agent": "until [ -x '" + Boxd + "' ]; do sleep 0.2; done; while :; do '" + Boxd + "'; sleep 1; done",
		"web": "mkdir -p '" + Logs + "'; { until [ -f '" + Ready + "' ]; do sleep 1; done; cd '" + App + "'; " +
			`while :; do sh -c 'echo '\''up'\'' # comment'; sleep 1; done; } 2>&1 | tee -a '` + Logs + "/web.log'",
		"db": "mkdir -p '" + Logs + "'; { sh -c 'postgres'; } 2>&1 | tee -a '" + Logs + "/db.log'",
	}
	for _, c := range cs {
		if w, ok := want[c.Name]; ok {
			if len(c.Command) != 3 || c.Command[2] != w {
				t.Errorf("container %s runs %q, want %q", c.Name, c.Command, w)
			}
			syntax(t, "container "+c.Name, c.Command[2])
			delete(want, c.Name)
		}
	}
	if len(want) > 0 {
		t.Errorf("no containers %v", want)
	}
}

func syntax(t *testing.T, what, script string) {
	t.Helper()
	if out, err := exec.Command("sh", "-n", "-c", script).CombinedOutput(); err != nil {
		t.Errorf("%s does not parse: %v %s", what, err, out)
	}
}
