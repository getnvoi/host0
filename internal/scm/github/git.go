package github

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Where git reaches repositories; tests point it at a local server.
var remote = "https://github.com"

func (Forge) Bundle(ctx context.Context, token, repo, branch, out string, line func(string)) error {
	g, err := newGit(token)
	if err != nil {
		return err
	}
	defer g.close()
	ref := "refs/heads/" + branch
	if err := g.run(ctx, line, "fetch", "--progress", "--no-tags", remote+"/"+repo, "+"+ref+":"+ref); err != nil {
		return fmt.Errorf("fetching %s@%s: %w", repo, branch, err)
	}
	if err := g.run(ctx, line, "bundle", "create", "-q", out, ref); err != nil {
		return fmt.Errorf("bundling %s@%s: %w", repo, branch, err)
	}
	return nil
}

func (Forge) Push(ctx context.Context, token, repo, bundle, branch string) error {
	g, err := newGit(token)
	if err != nil {
		return err
	}
	defer g.close()
	if err := g.run(ctx, nil, "fetch", "-q", bundle, "HEAD:refs/heads/pushed"); err != nil {
		return fmt.Errorf("reading the bundle: %w", err)
	}
	if err := g.run(ctx, nil, "push", "-q", remote+"/"+repo, "refs/heads/pushed:refs/heads/"+branch); err != nil {
		return fmt.Errorf("pushing %s to %s: %w", branch, repo, err)
	}
	return nil
}

// A bare repository of the plane's for one fetch or push, removed after it.
type git struct {
	dir, token string
}

func newGit(token string) (*git, error) {
	dir, err := os.MkdirTemp("", "h0-git-")
	if err != nil {
		return nil, err
	}
	g := &git{dir: dir, token: token}
	if err := g.run(context.Background(), nil, "init", "-q", "--bare"); err != nil {
		g.close()
		return nil, err
	}
	return g, nil
}

func (g *git) close() { os.RemoveAll(g.dir) }

// The token reaches git as a header in its environment: never in its arguments, a URL, a config file or its output.
func (g *git) env() []string {
	env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=", "SSH_ASKPASS=",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull)
	if g.token != "" {
		env = append(env, "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.extraheader", "GIT_CONFIG_VALUE_0="+g.header())
	}
	return env
}

func (g *git) header() string {
	return "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("x-access-token:"+g.token))
}

// Runs git in the bare repository; its output, masked, goes to line as it comes and ends any error.
func (g *git) run(ctx context.Context, line func(string), args ...string) error {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", g.dir}, args...)...)
	cmd.Env = g.env()
	r, w := io.Pipe()
	cmd.Stdout, cmd.Stderr = w, w
	var out bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Split(lines)
		for sc.Scan() {
			l := g.mask(sc.Text())
			if strings.TrimSpace(l) == "" {
				continue
			}
			out.WriteString(l + "\n")
			if line != nil {
				line(l)
			}
		}
		io.Copy(io.Discard, r)
	}()
	err := cmd.Run()
	w.Close()
	wg.Wait()
	if err != nil {
		said := strings.TrimSpace(out.String())
		// git asks for a username once the header it sent is refused, and cannot ask.
		if strings.Contains(said, "could not read Username") {
			said = "the token was refused: " + said
		}
		return fmt.Errorf("git %s: %v: %s", args[0], err, said)
	}
	return nil
}

func (g *git) mask(s string) string {
	if g.token == "" {
		return s
	}
	return strings.ReplaceAll(strings.ReplaceAll(s, g.header(), "Authorization: ***"), g.token, "***")
}

// Splits on \n and on the \r git's progress redraws its line with.
func lines(data []byte, atEOF bool) (int, []byte, error) {
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[:i], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}
