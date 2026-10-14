// The remote commands: thin calls to the plane, with the token the install left in ~/.hz/state.json.
package remote

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/hz/state"
	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/workspace"
)

func call(method, path string, in, out any) error {
	res, err := send(method, path, in)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if out != nil {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			return fmt.Errorf("%s %s: %w", method, path, err)
		}
	}
	return nil
}

// The response to a request that succeeded; the caller closes its body.
func send(method, path string, in any) (*http.Response, error) {
	st, err := state.Load()
	if err != nil {
		return nil, err
	}
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, st.URL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+st.Token)
	req.Header.Set("Content-Type", "application/json")
	return client.OK(http.DefaultClient.Do(req))
}

// The commands not yet generated from the spec.
func legacy() map[string]func() *cobra.Command {
	return map[string]func() *cobra.Command{"preview": preview, "open": open, "invite": invite, "ls": status,
		"pods": pods, "logs": podLogs, "usage": usage, "browsers": browsers, "logout": logout}
}

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

// A preview link carrying a gate token; the bare host answers 401.
func link(host string) string {
	var out struct{ URL string }
	if err := call("POST", "/previews", map[string]string{"host": host}, &out); err != nil {
		return "https://" + host + " (" + err.Error() + ")"
	}
	return out.URL
}

func preview() *cobra.Command {
	var check bool
	cmd := &cobra.Command{
		Use:   "preview <host>",
		Short: "A 12-hour link to a preview; --check opens it as a visitor would",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if check {
				return visit(args[0], link(args[0]), os.Stdout)
			}
			fmt.Println(link(args[0]))
			return nil
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "the gate refuses no token, the link sets the cookie, the cookie opens the app")
	return cmd
}

// nil is http.DefaultTransport; tests trust their own server with theirs.
var transport http.RoundTripper

var title = regexp.MustCompile(`(?is)<title>(.*?)</title>`)

// Visits host as a browser does: refused without a token, cookie from the link, the app with the cookie.
func visit(host, link string, out io.Writer) error {
	// A suspended sandbox resumes on the first request; that is the slowest answer a visitor waits for.
	client := &http.Client{Transport: transport, Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	get := func(url, cookie string) (*http.Response, string, error) {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, "", err
		}
		req.Header.Set("Accept", "text/html")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		res, err := client.Do(req)
		if err != nil {
			return nil, "", err
		}
		defer res.Body.Close()
		b, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		return res, string(b), err
	}
	root := "https://" + host + "/"
	res, _, err := get(root, "")
	if err != nil {
		return err
	}
	if c := res.TLS; c != nil && len(c.PeerCertificates) > 0 {
		cert := c.PeerCertificates[0]
		fmt.Fprintf(out, "tls        %s, issued by %s, until %s\n", cert.Subject.CommonName, cert.Issuer.CommonName, cert.NotAfter.Format("2006-01-02"))
	}
	fmt.Fprintf(out, "no token   %s\n", res.Status)
	if res.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("%s answers %s without a token; the gate is open", host, res.Status)
	}
	res, _, err = get(link, "")
	if err != nil {
		return err
	}
	var cookie string
	for _, c := range res.Cookies() {
		if c.Name == "hz_token" {
			cookie = c.Name + "=" + c.Value
		}
	}
	fmt.Fprintf(out, "link       %s, cookie %t\n", res.Status, cookie != "")
	if cookie == "" {
		return fmt.Errorf("the link to %s answered %s and set no hz_token cookie", host, res.Status)
	}
	start := time.Now()
	res, body, err := get(root, cookie)
	if err != nil {
		return err
	}
	t := ""
	if m := title.FindStringSubmatch(body); m != nil {
		t = strings.TrimSpace(m[1])
	}
	fmt.Fprintf(out, "cookie     %s in %s, title %q\n", res.Status, time.Since(start).Round(time.Millisecond), t)
	if res.StatusCode != http.StatusOK {
		said := strings.TrimSpace(body)
		if len(said) > 300 {
			said = said[:300] + "…"
		}
		return fmt.Errorf("%s answers %s with the cookie: %q", host, res.Status, said)
	}
	return nil
}

func loginLink(label string) (string, error) {
	var out struct{ URL string }
	err := call("POST", "/login-links", map[string]string{"label": label}, &out)
	return out.URL, err
}

func open() *cobra.Command {
	return &cobra.Command{
		Use:   "open",
		Short: "Sign this machine's browser in to the web UI",
		RunE: func(*cobra.Command, []string) error {
			url, err := loginLink(me())
			if err != nil {
				return err
			}
			if err := exec.Command("open", url).Run(); err != nil {
				if err := exec.Command("xdg-open", url).Run(); err != nil {
					fmt.Println(url)
				}
			}
			return nil
		},
	}
}

// The local user's name: what the plane records this browser's sessions and decisions under.
func me() string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	if name := os.Getenv("USER"); name != "" {
		return name
	}
	host, _ := os.Hostname()
	return host
}

func invite() *cobra.Command {
	return &cobra.Command{
		Use:   "invite <name>",
		Short: "A sign-in link for someone else's browser, valid 60 seconds and once",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			url, err := loginLink(args[0])
			if err == nil {
				fmt.Println(url)
			}
			return err
		},
	}
}
