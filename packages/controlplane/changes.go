package controlplane

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/controlplane/box"
	"github.com/getnvoi/host0/shared/contract"
)

const patchLimit = 2 << 20

// The session and its environment, with its actor running.
func (p *Plane) awake(ctx context.Context, sid string) (contract.Session, contract.Environment, error) {
	var s contract.Session
	if err := p.Store.Get("sessions", sid, &s); err != nil {
		return s, contract.Environment{}, err
	}
	env, _, err := p.env(s.Env)
	if err != nil {
		return s, env, err
	}
	return s, env, p.ensure(ctx, s.Actor, env.Tier)
}

// Untracked files count as added: they are marked intent-to-add first. The base is printed ahead of the numstat.
const diffScript = `git add -N -A . && base=origin/"$BASE" && { git rev-parse -q --verify "$base^{commit}" >/dev/null || base=HEAD; } && ` +
	`printf '%s\0' "$base" && git diff --no-color --no-ext-diff -M --numstat -z "$base" && printf '\0HZ\0' && ` +
	`git diff --no-color --no-ext-diff -M "$base"`

func (p *Plane) Changes(ctx context.Context, sid string) (contract.Changes, error) {
	s, env, err := p.awake(ctx, sid)
	if err != nil {
		return contract.Changes{}, err
	}
	out, code, err := p.box(s.Actor).Run(ctx, box.Run{Argv: sh(diffScript), Dir: App, Env: map[string]string{"BASE": env.Branch}})
	if err != nil {
		return contract.Changes{}, err
	}
	c, ok := changes(out)
	if !ok {
		return c, fmt.Errorf("git diff exited %d: %s", code, strings.TrimSpace(string(out)))
	}
	// Output cut short by boxd's cap ends the patch early.
	c.Truncated = c.Truncated || code != 0
	return c, nil
}

// Reads diffScript's output; false when it never reached the patch.
func changes(out []byte) (contract.Changes, bool) {
	c := contract.Changes{At: time.Now(), Files: []contract.FileChange{}}
	tokens := strings.Split(string(out), "\x00")
	if len(tokens) < 3 {
		return c, false
	}
	c.Base = tokens[0]
	i, found := 1, false
	for i < len(tokens) {
		t := tokens[i]
		if t == "" && i+1 < len(tokens) && tokens[i+1] == "HZ" {
			found = true
			break
		}
		parts := strings.SplitN(t, "\t", 3)
		if len(parts) != 3 {
			return c, false
		}
		f := contract.FileChange{Path: parts[2], Status: "modified"}
		if parts[2] == "" && i+2 < len(tokens) {
			f.OldPath, f.Path, f.Status = tokens[i+1], tokens[i+2], "renamed"
			i += 2
		}
		f.Added, _ = strconv.Atoi(parts[0])
		f.Removed, _ = strconv.Atoi(parts[1])
		f.Binary = parts[0] == "-"
		c.Added += f.Added
		c.Removed += f.Removed
		c.Files = append(c.Files, f)
		i++
	}
	if !found {
		return c, false
	}
	patch := strings.Join(tokens[i+2:], "\x00")
	statuses(patch, c.Files)
	if len(patch) > patchLimit {
		patch, c.Truncated = patch[:patchLimit], true
	}
	c.Patch = patch
	return c, true
}

// Sets added and deleted from the patch's headers; its files come in the numstat's order.
func statuses(patch string, files []contract.FileChange) {
	n := -1
	for line := range strings.Lines(patch) {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			n++
		case n < 0 || n >= len(files):
		case strings.HasPrefix(line, "new file mode"):
			files[n].Status = "added"
		case strings.HasPrefix(line, "deleted file mode"):
			files[n].Status = "deleted"
		}
	}
}
