// OpenAI's codex CLI: its credential, the command line for one turn and how its --json output reads.
package codex

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/getnvoi/host0/internal/llm"
)

// The MCP server name; tool events carry mcp__h0__<tool>, the name the plane and the UI read.
const Server = "h0"

type Runner struct{}

func (Runner) Key() string   { return "codex" }
func (Runner) Label() string { return "Codex" }

func (Runner) Fields() []llm.Field {
	return []llm.Field{
		{Key: "token", Label: "OpenAI API key", Type: "password", Required: true, Secret: true, Placeholder: "sk-..."},
		{Key: "base_url", Label: "Base URL", Type: "text", Placeholder: "https://api.openai.com/v1",
			Help: "Only for an OpenAI-compatible endpoint. Leave empty for OpenAI."},
		{Key: "model", Label: "Model", Type: "text", Placeholder: "gpt-5",
			Help: "Empty runs codex's default."},
	}
}

func (Runner) Install() string {
	return `command -v codex >/dev/null || { a=$(uname -m); curl -fsSL "https://github.com/openai/codex/releases/latest/download/codex-$a-unknown-linux-musl.tar.gz" | tar -xz -C /usr/local/bin && mv "/usr/local/bin/codex-$a-unknown-linux-musl" /usr/local/bin/codex; }`
}

func (Runner) Env(v map[string]string) map[string]string {
	// A token that is JSON is a ChatGPT sign-in's auth.json; anything else is an API key.
	env := map[string]string{"CODEX_API_KEY": v["token"]}
	if json.Valid([]byte(strings.TrimSpace(v["token"]))) {
		env = map[string]string{"H0_CODEX_AUTH": v["token"]}
	}
	if v["base_url"] != "" {
		env["OPENAI_BASE_URL"] = v["base_url"]
	}
	return env
}

func (Runner) Argv(t llm.Turn) []string {
	argv := []string{"sh", "-c", boot, "codex", "exec"}
	if t.Session != "" {
		argv = append(argv, "resume")
	}
	argv = append(argv, "--json", "--skip-git-repo-check", "--ignore-user-config",
		"--dangerously-bypass-approvals-and-sandbox",
		"-c", "mcp_servers."+Server+".command="+toml(t.MCP),
		"-c", "mcp_servers."+Server+`.args=["mcp"]`,
		"-c", "mcp_servers."+Server+`.env_vars=["H0_TOOLS"]`)
	if t.Model != "" {
		argv = append(argv, "-m", t.Model)
	}
	if t.Instructions != "" {
		argv = append(argv, "-c", "developer_instructions="+toml(t.Instructions))
	}
	if t.Session != "" {
		argv = append(argv, t.Session)
	}
	return append(argv, t.Prompt)
}

// codex refreshes a sign-in and rewrites auth.json, so the plane's copy is written only where there is none.
const boot = `mkdir -p "$HOME/.codex"; [ -z "$H0_CODEX_AUTH" ] || [ -f "$HOME/.codex/auth.json" ] || ` +
	`printf %s "$H0_CODEX_AUTH" > "$HOME/.codex/auth.json"; unset H0_CODEX_AUTH; exec codex "$@"`

// A JSON string is a TOML basic string: the same quotes and escapes.
func toml(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func (Runner) Transcript(line string) string {
	var d struct {
		Type   string `json:"type"`
		Thread string `json:"thread_id"`
	}
	json.Unmarshal([]byte(line), &d)
	if d.Type != "thread.started" {
		return ""
	}
	return d.Thread
}

var flaky = regexp.MustCompile(`(?i)stream disconnected|error sending request|reconnecting|connection (reset|refused|closed)|timed out|EAI_AGAIN|ENOTFOUND|overloaded|"status":\s*5\d\d`)

func (Runner) Transient(text string) bool { return flaky.MatchString(text) }

func (Runner) Relay([]llm.Event, string, string) (string, error) {
	return "", fmt.Errorf("codex has no sub-agents to write to")
}

func (Runner) Tool(name string) (string, bool) { return strings.CutPrefix(name, "mcp__"+Server+"__") }

type item struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	Message   string          `json:"message"`
	Command   string          `json:"command"`
	Output    string          `json:"aggregated_output"`
	ExitCode  *int            `json:"exit_code"`
	Server    string          `json:"server"`
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	Result    *struct {
		Content []struct{ Type, Text string } `json:"content"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
	Changes []struct{ Path, Kind string } `json:"changes"`
	Query   string                        `json:"query"`
	Items   json.RawMessage               `json:"items"`
}

// The events in one line of output; a line that is not JSON is a notice.
func (Runner) Events(line string) []llm.Event {
	var d struct {
		Type  string `json:"type"`
		Item  item   `json:"item"`
		Msg   string `json:"message"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Usage struct {
			Input  int64 `json:"input_tokens"`
			Cached int64 `json:"cached_input_tokens"`
			Output int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal([]byte(line), &d) != nil {
		if strings.TrimSpace(line) == "" {
			return nil
		}
		return []llm.Event{{Kind: "notice", Content: line}}
	}
	switch d.Type {
	case "item.started":
		return started(d.Item)
	case "item.completed":
		return completed(d.Item)
	case "turn.completed":
		// Cached input is left out, as for claude: each turn re-reads the whole context.
		meta, _ := json.Marshal(map[string]int64{"tokens": d.Usage.Input - d.Usage.Cached + d.Usage.Output})
		return []llm.Event{{Kind: "result", Meta: meta}}
	case "turn.failed":
		return []llm.Event{{Kind: "error", Content: reason(d.Error.Message)}}
	case "error":
		// codex says so while it reconnects; the turn fails with turn.failed.
		return []llm.Event{{Kind: "notice", Content: reason(d.Msg)}}
	}
	return nil
}

// The tool_use of an item that runs; it completes as a tool_result.
func started(it item) []llm.Event {
	switch it.Type {
	case "command_execution":
		return []llm.Event{use(it.ID, "Bash", map[string]string{"command": it.Command})}
	case "mcp_tool_call":
		return []llm.Event{{Kind: "tool_use", Tool: "mcp__" + it.Server + "__" + it.Tool, ToolID: it.ID, Content: args(it.Arguments)}}
	}
	return nil
}

func completed(it item) []llm.Event {
	switch it.Type {
	case "agent_message":
		return []llm.Event{{Kind: "message", Content: it.Text}}
	case "reasoning":
		return []llm.Event{{Kind: "thinking", Content: it.Text}}
	case "error":
		return []llm.Event{{Kind: "notice", Content: it.Message}}
	case "command_execution":
		out := it.Output
		if it.ExitCode != nil && *it.ExitCode != 0 {
			out += fmt.Sprintf("\nexit %d", *it.ExitCode)
		}
		return []llm.Event{{Kind: "tool_result", ToolID: it.ID, Content: out}}
	case "mcp_tool_call":
		var b []string
		if it.Result != nil {
			for _, c := range it.Result.Content {
				b = append(b, c.Text)
			}
		}
		if it.Error != nil {
			b = append(b, it.Error.Message)
		}
		return []llm.Event{{Kind: "tool_result", ToolID: it.ID, Content: strings.Join(b, "\n")}}
	case "file_change":
		var paths []string
		for _, c := range it.Changes {
			paths = append(paths, c.Kind+" "+c.Path)
		}
		first := ""
		if len(it.Changes) > 0 {
			first = it.Changes[0].Path
		}
		return []llm.Event{use(it.ID, "Edit", map[string]string{"file_path": first}),
			{Kind: "tool_result", ToolID: it.ID, Content: strings.Join(paths, "\n")}}
	case "web_search":
		return []llm.Event{use(it.ID, "WebSearch", map[string]string{"query": it.Query}),
			{Kind: "tool_result", ToolID: it.ID}}
	case "todo_list":
		return []llm.Event{{Kind: "tool_use", Tool: "TodoWrite", ToolID: it.ID, Content: `{"todos":` + args(it.Items) + `}`},
			{Kind: "tool_result", ToolID: it.ID}}
	}
	return nil
}

func use(id, tool string, input map[string]string) llm.Event {
	b, _ := json.Marshal(input)
	return llm.Event{Kind: "tool_use", Tool: tool, ToolID: id, Content: string(b)}
}

func args(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return "{}"
	}
	return string(raw)
}

// An API error arrives as its JSON body; its message is the sentence.
func reason(msg string) string {
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(msg), &e) == nil && e.Error.Message != "" {
		return e.Error.Message
	}
	return msg
}
