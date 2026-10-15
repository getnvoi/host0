package github

import (
	"context"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func sh(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull,
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// git http-backend over root, as GitHub serves it: Basic x-access-token:<token>, anything else 401.
func forge(t *testing.T, token string) (root string, seen *[]string) {
	t.Helper()
	root = t.TempDir()
	backend := filepath.Join(sh(t, root, "--exec-path"), "git-http-backend")
	if _, err := os.Stat(backend); err != nil {
		t.Fatalf("git http-backend: %v", err)
	}
	h := &cgi.Handler{Path: backend, Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=" + os.DevNull}}
	seen = new([]string)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = append(*seen, r.URL.String())
		if u, p, ok := r.BasicAuth(); !ok || u != "x-access-token" || p != token {
			w.Header().Set("WWW-Authenticate", `Basic realm="GitHub"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	old := remote
	remote = srv.URL
	t.Cleanup(func() { remote = old })
	return root, seen
}

// o/r on the forge: main with one commit, which a clone of it can push to.
func repo(t *testing.T, root string) string {
	t.Helper()
	bare := filepath.Join(root, "o", "r")
	os.MkdirAll(bare, 0o755)
	sh(t, bare, "init", "-q", "--bare", "-b", "main")
	sh(t, bare, "config", "http.receivepack", "true")
	work := t.TempDir()
	sh(t, work, "init", "-q", "-b", "main")
	os.WriteFile(filepath.Join(work, "README"), []byte("one\n"), 0o644)
	sh(t, work, "add", "README")
	sh(t, work, "commit", "-q", "-m", "one")
	sh(t, work, "push", "-q", bare, "main")
	return bare
}

// The plane bundles the branch, the sandbox clones the bundle, commits, bundles HEAD back; the plane pushes it.
func TestBundleAndPushRoundTrip(t *testing.T) {
	const token = "ghs_secret"
	root, seen := forge(t, token)
	bare := repo(t, root)
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "checkout.bundle")
	var said []string
	if err := (Forge{}).Bundle(ctx, token, "o/r", "main", out, func(l string) { said = append(said, l) }); err != nil {
		t.Fatal(err)
	}
	for _, l := range said {
		if strings.Contains(l, token) {
			t.Fatalf("git printed the token: %q", l)
		}
	}
	box := t.TempDir()
	app := filepath.Join(box, "app")
	sh(t, box, "clone", "-q", "--branch", "main", out, app)
	sh(t, app, "remote", "set-url", "origin", "https://github.com/o/r")
	if got := sh(t, app, "log", "--format=%s"); got != "one" {
		t.Fatalf("checkout holds %q", got)
	}
	sh(t, app, "checkout", "-q", "-b", "h0/s1")
	os.WriteFile(filepath.Join(app, "README"), []byte("two\n"), 0o644)
	sh(t, app, "commit", "-q", "-am", "two")
	back := filepath.Join(box, "push.bundle")
	sh(t, app, "bundle", "create", "-q", back, "HEAD")
	if err := (Forge{}).Push(ctx, token, "o/r", back, "h0/s1"); err != nil {
		t.Fatal(err)
	}
	if got, want := sh(t, bare, "rev-parse", "refs/heads/h0/s1"), sh(t, app, "rev-parse", "HEAD"); got != want {
		t.Fatalf("forge's h0/s1 at %s, not %s", got, want)
	}
	for _, u := range *seen {
		if strings.Contains(u, token) {
			t.Fatalf("the token went in a URL: %s", u)
		}
	}
}

// A refused token fails with git's own sentence, the token masked out of it.
func TestBundleRefusedToken(t *testing.T) {
	root, _ := forge(t, "right")
	repo(t, root)
	err := (Forge{}).Bundle(context.Background(), "wrong", "o/r", "main", filepath.Join(t.TempDir(), "b"), nil)
	if err == nil || !strings.Contains(err.Error(), "fetching o/r@main") || !strings.Contains(err.Error(), "the token was refused") {
		t.Fatalf("err %v", err)
	}
	if strings.Contains(err.Error(), "wrong") {
		t.Fatalf("the token is in the error: %v", err)
	}
}
