// Pinned upstream checkouts, with our patches applied, in the laptop's cache.
package source

import (
	"context"
	"embed"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Repo struct {
	Name, URL, Commit string
	Patches           []string
}

var (
	Substrate = Repo{"substrate", "https://github.com/agent-substrate/substrate", "31a5e0ba29a525b3587882132fa13bd211653152",
		[]string{"substrate-ko-platform.patch", "substrate-atelet.patch"}}
	// On this machine: atelet keeps kind's own registry, which the Hetzner patch replaces; both can remove what a
	// sandbox's services own (postgres's 0700 data directory) when a sandbox is reset.
	SubstrateLocal = Repo{"substrate-local", Substrate.URL, Substrate.Commit, []string{"substrate-ko-platform.patch", "substrate-atelet-local.patch"}}
)

// What ate-setup labels nodes with (git describe --always --dirty); atelet runs only where it is set.
func (r Repo) Version() string {
	v := r.Commit[:8]
	if len(r.Patches) > 0 {
		v += "-dirty"
	}
	return v
}

//go:embed patches/*.patch
var patches embed.FS

// The checkout's directory, at Commit and patched; a checkout that has drifted is reset.
func (r Repo) Dir(ctx context.Context, cache string, out io.Writer) (string, error) {
	dir := filepath.Join(cache, r.Name)
	git := func(args ...string) error { return Cmd(ctx, dir, nil, out, "git", args...) }
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		if err := os.MkdirAll(cache, 0o700); err != nil {
			return "", err
		}
		if err := Cmd(ctx, cache, nil, out, "git", "clone", "-q", r.URL, dir); err != nil {
			return "", err
		}
	}
	if err := git("fetch", "-q", "origin"); err != nil {
		return "", err
	}
	if err := git("checkout", "-q", "--force", r.Commit); err != nil {
		return "", err
	}
	if err := git("clean", "-qfd"); err != nil {
		return "", err
	}
	for _, p := range r.Patches {
		b, err := patches.ReadFile("patches/" + p)
		if err != nil {
			return "", err
		}
		if err := Cmd(ctx, dir, strings.NewReader(string(b)), out, "git", "apply", "-"); err != nil {
			return "", fmt.Errorf("%s: %w", p, err)
		}
	}
	return dir, nil
}

func Cmd(ctx context.Context, dir string, stdin io.Reader, out io.Writer, name string, args ...string) error {
	return CmdEnv(ctx, dir, nil, stdin, out, name, args...)
}

func CmdEnv(ctx context.Context, dir string, env []string, stdin io.Reader, out io.Writer, name string, args ...string) error {
	return run(ctx, dir, env, stdin, out, out, name, args...)
}

// Stdout as a string; stderr goes to out.
func Capture(ctx context.Context, dir string, env []string, stdin io.Reader, out io.Writer, name string, args ...string) (string, error) {
	var b strings.Builder
	err := run(ctx, dir, env, stdin, &b, out, name, args...)
	return b.String(), err
}

func run(ctx context.Context, dir string, env []string, stdin io.Reader, stdout, stderr io.Writer, name string, args ...string) error {
	c := exec.CommandContext(ctx, name, args...)
	c.Dir, c.Stdin, c.Stdout, c.Stderr = dir, stdin, stdout, stderr
	c.Env = append(os.Environ(), env...)
	if err := c.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}
