package codex

import (
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/llm"
)

// Captured from codex-cli 0.157.1 with the h0 MCP server.
func read(t *testing.T, name string) ([]llm.Event, string) {
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	var evs []llm.Event
	id := ""
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		evs = append(evs, Runner{}.Events(line)...)
		if s := (Runner{}).Transcript(line); s != "" {
			id = s
		}
	}
	return evs, id
}

func TestTool(t *testing.T) {
	evs, id := read(t, "tool.jsonl")
	if id != "01a0e62c-4336-7d80-bd76-a8277d7304fb" {
		t.Fatalf("transcript %q", id)
	}
	want := []llm.Event{
		{Kind: "tool_use", Tool: "mcp__h0__set_title", ToolID: "item_0", Content: `{"title":"ok"}`},
		{Kind: "tool_result", ToolID: "item_0", Content: "Queued. This action is performed for you once your turn ends and you will be told the outcome. End your turn now with a one-line summary of what you asked for."},
		{Kind: "message", Content: "ok"},
		{Kind: "result", Meta: []byte(`{"tokens":10557}`)},
	}
	if !reflect.DeepEqual(evs, want) {
		t.Fatalf("got %+v", evs)
	}
	if name, ok := (Runner{}).Tool(evs[0].Tool); !ok || name != "set_title" {
		t.Fatalf("tool %q", name)
	}
}

func TestResume(t *testing.T) {
	evs, _ := read(t, "resume.jsonl")
	if len(evs) != 4 || evs[0].Tool != "Bash" || evs[0].Content != `{"command":"/bin/zsh -lc 'echo hi'"}` ||
		evs[1].Content != "hi\n" || evs[2].Content != "done" {
		t.Fatalf("got %+v", evs)
	}
}

func TestFailed(t *testing.T) {
	evs, _ := read(t, "failed.jsonl")
	last := evs[len(evs)-1]
	if last.Kind != "error" || last.Content != "The 'no-such-model' model is not supported when using Codex with a ChatGPT account." {
		t.Fatalf("got %+v", evs)
	}
	if (Runner{}).Transient(last.Content) {
		t.Fatal("a refused model is not transient")
	}
}

func TestEnvTellsASignInFromAKey(t *testing.T) {
	if env := (Runner{}).Env(map[string]string{"token": "sk-x"}); env["CODEX_API_KEY"] != "sk-x" || len(env) != 1 {
		t.Fatalf("key: %v", env)
	}
	auth := `{"tokens":{"refresh_token":"r"}}`
	if env := (Runner{}).Env(map[string]string{"token": auth}); env["H0_CODEX_AUTH"] != auth || len(env) != 1 {
		t.Fatalf("sign-in: %v", env)
	}
}

func TestArgv(t *testing.T) {
	got := Runner{}.Argv(llm.Turn{Prompt: "hi", Session: "s1", Model: "gpt-5", Instructions: `say "x"`, MCP: "/boxd"})
	want := []string{"sh", "-c", boot, "codex", "exec", "resume", "--json", "--skip-git-repo-check", "--ignore-user-config",
		"--dangerously-bypass-approvals-and-sandbox", "-c", `mcp_servers.h0.command="/boxd"`, "-c", `mcp_servers.h0.args=["mcp"]`,
		"-c", `mcp_servers.h0.env_vars=["H0_TOOLS"]`, "-m", "gpt-5", "-c", `developer_instructions="say \"x\""`, "s1", "hi"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
}

// Runs the plane's command line against the codex on this machine; H0_BOXD is a built boxd.
func TestLive(t *testing.T) {
	boxd := os.Getenv("H0_BOXD")
	if boxd == "" {
		t.Skip("H0_BOXD not set")
	}
	dir := t.TempDir()
	run := func(prompt, session string) ([]llm.Event, string) {
		argv := Runner{}.Argv(llm.Turn{Prompt: prompt, Session: session, MCP: boxd, Instructions: "Answer in one word."})
		cmd := exec.Command(argv[0], argv[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), `H0_TOOLS=[{"name":"set_title","description":"Name this task.","inputSchema":{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}}]`)
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		var evs []llm.Event
		id := ""
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			evs = append(evs, Runner{}.Events(line)...)
			if s := (Runner{}).Transcript(line); s != "" {
				id = s
			}
		}
		return evs, id
	}
	evs, id := run("Call set_title with title ok, then reply ok.", "")
	if id == "" || !has(evs, "tool_use", "mcp__h0__set_title") || !has(evs, "result", "") {
		t.Fatalf("first turn %s: %+v", id, evs)
	}
	evs, again := run("Reply ok.", id)
	if again != id || !has(evs, "message", "") {
		t.Fatalf("resume %s: %+v", again, evs)
	}
}

func has(evs []llm.Event, kind, tool string) bool {
	for _, e := range evs {
		if e.Kind == kind && (tool == "" || e.Tool == tool) {
			return true
		}
	}
	return false
}
