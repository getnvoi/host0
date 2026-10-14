// The remote commands: thin calls to the plane, with the token the install left in ~/.hz/state.json.
package remote

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/hz/state"
	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/workspace"
)

func init() { written["env seed"] = seed }

func seed() *cobra.Command {
	return &cobra.Command{
		Use:   "seed <env>",
		Short: "Build the environment's seed: clone, set up, start its services, snapshot and tag it",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			st, err := state.Load()
			if err != nil {
				return err
			}
			return (&build{st: st, env: args[0], out: os.Stdout}).follow()
		},
	}
}

// No new step and no new output for this long is a hang, however often the plane repeats the build's row.
var silence = 10 * time.Second

// Pause before reopening a dropped stream, times the attempt.
var backoff = time.Second

const attempts = 4

// A seed build followed on the plane's stream, opened before the build is asked for so no step is missed.
type build struct {
	st                    state.State
	c                     *client.Client
	env, last, step, line string
	lines                 int
	asked                 bool
	out                   io.Writer
}

func (b *build) follow() error {
	c, err := connect(b.st)
	if err != nil {
		return err
	}
	b.c = c
	for drops := 1; ; drops++ {
		drop, heard, err := b.once()
		if !drop {
			return err
		}
		if heard {
			drops = 1
		}
		if drops == attempts {
			return fmt.Errorf("the plane's stream dropped %d times in a row: %w", attempts, err)
		}
		fmt.Fprintf(b.out, "  stream dropped (%v), reconnecting\n", err)
		time.Sleep(time.Duration(drops) * backoff)
	}
}

// One connection. drop: it ended and may be opened again, err saying why; otherwise err is the build's outcome.
// heard: the seed was reported on it.
func (b *build) once() (drop, heard bool, err error) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	frames := make(chan frame)
	ended := make(chan error, 1)
	go func() { ended <- listen(ctx, b.c, b.last, frames) }()
	quiet := time.NewTimer(silence)
	defer quiet.Stop()
	for {
		select {
		case err := <-ended:
			return true, heard, err
		case <-quiet.C:
			return false, heard, fmt.Errorf("no progress on the seed of %s for %s; last step: %s; last line: %q",
				b.env, silence, b.step, b.line)
		case f := <-frames:
			if f.id != "" {
				b.last = f.id
			}
			var s workspace.Seed
			switch {
			case !b.asked:
				if err := client.Done(b.c.EnvSeed(ctx, b.env)); err != nil {
					return false, heard, err
				}
				b.asked = true
				continue
			case f.u == nil:
				continue
			case f.u.Kind == "reset":
				// The plane restarted or this reader fell behind its ring: the row says where the build stands.
				if s, err = client.Read[workspace.Seed](b.c.EnvStatus(ctx, b.env)); err != nil {
					return false, heard, err
				}
				// The row keeps no output count: only a new step or state counts as progress here.
				s.Lines = b.lines
			case f.u.Kind == "seed" && f.u.Seed.Env == b.env:
				s = *f.u.Seed
			default:
				continue
			}
			moved, done, err := b.show(s)
			if done {
				return false, heard, err
			}
			if moved {
				heard = true
				quiet.Reset(silence)
			}
		}
	}
}

// Prints what changed. moved: a new step or new output, the only thing that counts as progress; done: the build
// rests.
func (b *build) show(s workspace.Seed) (moved, done bool, err error) {
	switch s.State {
	case "ready":
		fmt.Fprintf(b.out, "seed ready: %s\n", link(s.Preview))
		return true, true, nil
	case "failed":
		return true, true, fmt.Errorf("seed failed: %s", s.Error)
	}
	if s.Step != b.step {
		b.step, b.line, moved = s.Step, "", true
		fmt.Fprintf(b.out, "  %s\n", s.Step)
	}
	if s.Lines != b.lines {
		b.lines, moved = s.Lines, true
	}
	if s.Line != "" && s.Line != b.line {
		b.line = s.Line
		fmt.Fprintf(b.out, "    %s\n", s.Line)
	}
	return moved, false, nil
}

// One message of the plane's stream: its id, and the update it carries, if any.
type frame struct {
	id string
	u  *workspace.Update
}

// Reads the stream from after last, sending each message to out, and returns why it ended.
func listen(ctx context.Context, c *client.Client, last string, out chan<- frame) error {
	params := &client.StreamParams{}
	if last != "" {
		params.LastEventID = &last
	}
	res, err := client.OK(c.Stream(ctx, params))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	// A session's update carries its new events, which can be long.
	sc.Buffer(make([]byte, 64<<10), 16<<20)
	var f frame
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			if f.id != "" || f.u != nil {
				select {
				case out <- f:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			f = frame{}
		case strings.HasPrefix(line, "id: "):
			f.id = strings.TrimPrefix(line, "id: ")
		case strings.HasPrefix(line, "data: "):
			var u workspace.Update
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &u); err != nil {
				return fmt.Errorf("the stream sent %q: %w", line, err)
			}
			f.u = &u
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	return errors.New("the plane closed the stream")
}
