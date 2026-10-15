package workspace

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/shared/mask"
)

// An environment secret, and its base64 as a basic auth header or a k8s secret shows it.
const held = "sk_live_9f8e7d6c5b4a"

var held64 = base64.StdEncoding.EncodeToString([]byte(held))

// Fails when s shows the secret in either form.
func clean(t *testing.T, where, s string) {
	t.Helper()
	if strings.Contains(s, held) || strings.Contains(s, held64) {
		t.Errorf("%s shows the secret: %s", where, s)
	}
}

// Tools that answer with what they were given and the secret's base64, and keep each input.
type echo struct {
	idle
	mu  sync.Mutex
	got []string
}

func (e *echo) Call(_ context.Context, _, _, name, input string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.got = append(e.got, name+" "+input)
	return name + ": took " + input + ", answered " + held64
}

func (e *echo) calls() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string{}, e.got...)
}

// What the agent says and asks is stored masked, its tools run on what it asked, and what they answer is masked.
func TestTurnMasksEventsAnswersAndApprovals(t *testing.T) {
	p, fb := withBoxd(t)
	tools := &echo{}
	p.Tools = tools
	env(t, p, Environment{Name: "web", Branch: "main", Secrets: map[string]string{"STRIPE_KEY": held}})
	if _, err := p.PutAgent(agentName, AgentInput{Tools: map[string]string{"session_title": "auto", "session_pr": "approval"}}); err != nil {
		t.Fatal(err)
	}
	say := `{"type":"assistant","message":{"content":[{"type":"text","text":"the key is ` + held + ` or ` + held64 +
		`; nothing else here"}]}}` + "\n"
	use := func(id, name, input string) string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__h0__` + name + `","id":"` + id +
			`","input":` + input + `}]}}` + "\n"
	}
	title, pr := `{"title":"`+held+`"}`, `{"body":"`+held64+`"}`
	fb.logs["turn-1"] = true
	fb.lines["turn-1"] = say + use("t1", "session_title", title) + use("t2", "session_pr", pr) +
		`{"type":"result","result":"done"}` + "\n"
	sessionRow(t, p, Session{ID: "mk1", Env: "web", Actor: "wt-mk1", State: "running",
		Forked: true, Turns: 1, Events: []llm.Event{{Kind: "prompt", Content: "go"}}})
	p.Recover()
	until(t, "mk1 awaiting approval", func() bool { return session(p, "mk1").State == "awaiting_approval" })

	s := session(p, "mk1")
	said := false
	for _, ev := range s.Events {
		clean(t, "event "+ev.Kind, ev.Content+string(ev.Meta))
		said = said || ev.Content == "the key is "+mask.Marker+" or "+mask.Marker+"; nothing else here"
	}
	if !said {
		t.Errorf("no message masked, the rest untouched: %+v", s.Events)
	}
	if want := `session_title: took {"title":"` + mask.Marker + `"}, answered ` + mask.Marker; len(s.Outcomes) != 1 || s.Outcomes[0] != want {
		t.Errorf("tool answer %q", s.Outcomes)
	}
	if got := tools.calls(); len(got) != 1 || got[0] != "session_title "+title {
		t.Errorf("the tool ran on %q", got)
	}

	asks, err := p.Approvals("mk1", "pending")
	if err != nil || len(asks) != 1 || asks[0].Input != `{"body":"`+mask.Marker+`"}` {
		t.Fatalf("approvals %+v %v", asks, err)
	}
	var row db.Approval
	if err := p.DB.Where("public_id = ?", asks[0].ID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	clean(t, "the approval's input column", string(row.Input))
	if row.Call != pr {
		t.Errorf("sealed call %q", row.Call)
	}
	if _, err := p.Decide(asks[0].ID, true, "ben"); err != nil {
		t.Fatal(err)
	}
	until(t, "the approved tool", func() bool { return len(tools.calls()) == 2 })
	if got := tools.calls()[1]; got != "session_pr "+pr {
		t.Errorf("the approved tool ran on %q", got)
	}
	p.Wait()
	a, err := p.Approval(asks[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	clean(t, "the approval's outcome", a.Outcome)
	if !strings.Contains(a.Outcome, mask.Marker) {
		t.Errorf("outcome %q", a.Outcome)
	}
}

// A session's error, and a refusal's, say the secret masked and keep what they wrap.
func TestErrorsMasked(t *testing.T) {
	p := newWorkspace(t, nil)
	env(t, p, Environment{Name: "web", Secrets: map[string]string{"STRIPE_KEY": held}})
	sessionRow(t, p, Session{ID: "mk2", Env: "web", State: "running"})
	s := session(p, "mk2")
	p.fail(&s, fmt.Errorf("the API refused %s (%s)", held, held64))
	if got := session(p, "mk2").Error; got != "the API refused "+mask.Marker+" ("+mask.Marker+")" {
		t.Errorf("session error %q", got)
	}
	err := p.MaskErr(NotFound{fmt.Errorf("no environment %s", held)})
	if err.Error() != "no environment "+mask.Marker || !errors.As(err, new(NotFound)) {
		t.Errorf("%v %T", err, err)
	}
	if p.MaskErr(nil) != nil {
		t.Error("nil masked into an error")
	}
}

// Each credential the plane holds is masked once written: a secret, the GitHub token, an agent credential's secret
// field, and boxd's tokens; a plain variable is not.
func TestHeld(t *testing.T) {
	p := newWorkspace(t, nil)
	p.BoxToken = "box-token-0123456789"
	env(t, p, Environment{Name: "web", Env: map[string]string{"RAILS_ENV": "development"},
		Secrets: map[string]string{"STRIPE_KEY": held}})
	if err := p.PutCredentials(Credentials{GitHub: "ghp_abcdefgh12345678"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.AddConfig(context.Background(), LLMConfigInput{Name: "work", Provider: "claude_code",
		Values: map[string]string{"kind": "api_key", "token": "sk-ant-api03-abcdefgh"}}); err != nil {
		t.Fatal(err)
	}
	in := strings.Join([]string{held, "ghp_abcdefgh12345678", "sk-ant-api03-abcdefgh", p.BoxToken, p.derive("env", "web"),
		"development"}, " ")
	want := strings.Repeat(mask.Marker+" ", 5) + "development"
	if got := p.Mask(in); got != want {
		t.Errorf("masked %q", got)
	}
}

// A seed's output is masked in the plane's log, its last line and its error.
func TestSeedOutputMasked(t *testing.T) {
	silence = 200 * time.Millisecond
	t.Cleanup(func() { silence = 10 * time.Second })
	var out bytes.Buffer
	log.SetOutput(&out)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	var script seedRun
	speak := seedBoxd(&script)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "DELETE":
		case strings.HasSuffix(r.URL.Path, "/log") && r.URL.Query().Get("offset") == "0":
			fmt.Fprintf(w, "%ssetup: npm ci\ntoken %s then %s\n", stepMark, held64, held)
		case strings.HasSuffix(r.URL.Path, "/log"):
			<-r.Context().Done()
		default:
			speak(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	p := newWorkspace(t, seeder{&fakeSandbox{boxed: boxed{addr: srv.Listener.Addr().String()}}})
	env(t, p, Environment{Name: "shop", Repo: "acme/shop", Branch: "main", Setup: []string{"npm ci"}, Preview: 3000,
		Secrets: map[string]string{"STRIPE_KEY": held}})
	c := p.Bus.(*bus).tap(t)
	if err := p.Reseed("shop"); err != nil {
		t.Fatal(err)
	}
	all, last := seedUpdates(t, c, "shop")
	line := "token " + mask.Marker + " then " + mask.Marker
	if last.State != "failed" || last.Error != `setup: npm ci: no output for 200ms; last line: "`+line+`"` {
		t.Fatalf("rested on %+v", last)
	}
	for _, s := range all {
		clean(t, "a seed update", s.Step+s.Line+s.Error)
	}
	var row db.Seed
	if err := p.DB.Last(&row).Error; err != nil {
		t.Fatal(err)
	}
	clean(t, "the seed row", row.Error+row.Step)
	clean(t, "the plane's log", out.String())
	if !strings.Contains(out.String(), "seed shop | "+line) {
		t.Errorf("the log has no masked line:\n%s", out.String())
	}
}
