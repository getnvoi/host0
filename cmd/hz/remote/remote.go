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
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/hz/state"
	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/llm"
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
	return map[string]func() *cobra.Command{"session": session, "approval": approval, "preview": preview, "open": open, "invite": invite, "ls": status,
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
	go func() { ended <- listen(ctx, b.st, b.last, frames) }()
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
func listen(ctx context.Context, st state.State, last string, out chan<- frame) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", st.URL+"/stream", nil)
	req.Header.Set("Authorization", "Bearer "+st.Token)
	if last != "" {
		req.Header.Set("Last-Event-ID", last)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("GET /stream: %s", strings.TrimSpace(string(b)))
	}
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

func session() *cobra.Command {
	cmd := &cobra.Command{Use: "session", Short: "Sessions: a fork of the seed and the agent working in it"}
	cmd.AddCommand(&cobra.Command{
		Use:  "start <env> <prompt>",
		Args: cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			var s workspace.Session
			if err := call("POST", "/sessions", map[string]string{"env": args[0], "prompt": args[1]}, &s); err != nil {
				return err
			}
			fmt.Printf("session %s on %s, preview %s\n", s.ID, s.Branch, link(s.Preview))
			return follow(s.ID)
		},
	}, &cobra.Command{
		Use:  "say <id> <prompt>",
		Args: cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			if err := call("POST", "/sessions/"+args[0]+"/turns", map[string]string{"prompt": args[1]}, nil); err != nil {
				return err
			}
			return follow(args[0])
		},
	}, &cobra.Command{
		Use:   "suspend <id>",
		Short: "Snapshot the session and free its worker; a preview request or a turn resumes it",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return call("POST", "/sessions/"+args[0]+"/suspend", nil, nil)
		},
	}, &cobra.Command{
		Use:  "follow <id>",
		Args: cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error { return follow(args[0]) },
	})
	cmd.AddCommand(sessions()...)
	return cmd
}

// Prints events as they arrive until the session stops for the user.
func follow(id string) error { return watch(id, false) }

// Prints the session's events until it rests. decided: an approval was just decided, so a session still awaiting
// approval with none left open is carrying the action out, and is watched on.
func watch(id string, decided bool) error {
	seen := 0
	for {
		var s workspace.Session
		if err := call("GET", "/sessions/"+id, nil, &s); err != nil {
			return err
		}
		for _, ev := range s.Events[min(seen, len(s.Events)):] {
			print(ev)
		}
		seen = len(s.Events)
		switch s.State {
		case "awaiting_approval":
			if decided && !asking(s.ID) {
				break
			}
			fmt.Printf("session %s: %s %s\n", s.ID, s.State, s.Error)
			return nil
		case "idle", "failed":
			fmt.Printf("session %s: %s %s\n", s.ID, s.State, s.Error)
			return nil
		}
		time.Sleep(2 * time.Second)
	}
}

// Whether the session has approvals still waiting for a decision.
func asking(sid string) bool {
	var as []workspace.Approval
	if call("GET", "/approvals", nil, &as) != nil {
		return true
	}
	for _, a := range as {
		if a.Session == sid {
			return true
		}
	}
	return false
}

func print(ev llm.Event) {
	c := strings.TrimSpace(ev.Content)
	if len(c) > 300 {
		c = c[:300] + "…"
	}
	switch ev.Kind {
	case "tool_use":
		fmt.Printf("  → %s %s\n", ev.Tool, c)
	case "tool_result":
		fmt.Printf("  ← %s\n", strings.ReplaceAll(c, "\n", " "))
	case "message", "result", "prompt", "error":
		fmt.Printf("%s: %s\n", ev.Kind, c)
	case "notice":
		fmt.Printf("  %s\n", c)
	}
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

func approval() *cobra.Command {
	cmd := &cobra.Command{Use: "approval", Short: "Actions waiting for a decision"}
	cmd.AddCommand(&cobra.Command{
		Use:   "show <id>",
		Short: "One approval in full, decided or not",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			var a workspace.Approval
			if err := call("GET", "/approvals/"+url.PathEscape(args[0]), nil, &a); err != nil {
				return err
			}
			showApproval(os.Stdout, a)
			return nil
		},
	})
	cmd.AddCommand(&cobra.Command{
		Use: "list",
		RunE: func(*cobra.Command, []string) error {
			var as []workspace.Approval
			if err := call("GET", "/approvals", nil, &as); err != nil {
				return err
			}
			for _, a := range as {
				fmt.Printf("%s  session %s  %s %s\n", a.ID, a.Session, a.Tool, a.Input)
			}
			return nil
		},
	})
	for _, d := range []string{"approve", "deny"} {
		cmd.AddCommand(&cobra.Command{
			Use:  d + " <id>",
			Args: cobra.ExactArgs(1),
			RunE: func(_ *cobra.Command, args []string) error {
				var a workspace.Approval
				if err := call("POST", "/approvals/"+args[0]+"/"+d, nil, &a); err != nil {
					return err
				}
				fmt.Printf("%s %s: %s\n", a.Tool, a.ID, a.State)
				return watch(a.Session, true)
			},
		})
	}
	return cmd
}

func showApproval(w io.Writer, a workspace.Approval) {
	fmt.Fprintf(w, "id       %s\nsession  %s\ntool     %s\nstate    %s\nasked    %s\n", a.ID, a.Session, a.Tool, a.State,
		a.At.Format(time.RFC3339))
	if !a.Decided.IsZero() {
		fmt.Fprintf(w, "decided  %s by %s\n", a.Decided.Format(time.RFC3339), a.By)
	}
	if a.Outcome != "" {
		fmt.Fprintf(w, "outcome  %s\n", a.Outcome)
	}
	fmt.Fprintf(w, "input\n%s\n", a.Input)
}
