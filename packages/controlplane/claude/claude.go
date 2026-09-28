// Anthropic's claude CLI: its credential, the command line for one turn and how its stream-json reads.
package claude

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/getnvoi/host0/controlplane/llm"
	"github.com/getnvoi/host0/shared/contract"
)

// The MCP server name; the CLI prefixes its tools with mcp__hz__.
const Server = "hz"

// The CLI reads a credential only from the variable of its kind: an API key in CLAUDE_CODE_OAUTH_TOKEN is "Not logged in".
var credential = map[string]string{
	"oauth":   "CLAUDE_CODE_OAUTH_TOKEN",
	"api_key": "ANTHROPIC_API_KEY",
	"bearer":  "ANTHROPIC_AUTH_TOKEN",
}

type Runner struct{}

func (Runner) Key() string   { return "claude_code" }
func (Runner) Label() string { return "Claude Code" }

func (Runner) Fields() []contract.Field {
	return []contract.Field{
		{Key: "kind", Label: "Credential kind", Type: "select", Required: true,
			Help: "oauth for a Claude subscription, api_key for an Anthropic key, bearer for a third-party endpoint such as z.ai or Kimi",
			Options: []contract.Option{{Value: "oauth", Label: "Claude subscription (OAuth)"},
				{Value: "api_key", Label: "Anthropic API key"}, {Value: "bearer", Label: "Third-party endpoint (bearer)"}}},
		{Key: "token", Label: "Token", Type: "password", Required: true, Secret: true, Placeholder: "sk-ant-..."},
		{Key: "base_url", Label: "Base URL", Type: "text", Placeholder: "https://api.anthropic.com",
			Help: "Only for a third-party endpoint. Leave empty for Anthropic."},
		{Key: "model", Label: "Model", Type: "select", Default: "sonnet",
			Help: "The vendor's alias; it follows their current model.",
			Options: []contract.Option{{Value: "sonnet", Label: "Sonnet"}, {Value: "opus", Label: "Opus"}, {Value: "haiku", Label: "Haiku"}}},
	}
}

func (Runner) Install() string {
	return "command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash"
}

// IS_SANDBOX lets bypassPermissions run as root.
func (Runner) Env(v map[string]string) map[string]string {
	env := map[string]string{credential[v["kind"]]: v["token"], "IS_SANDBOX": "1"}
	if v["base_url"] != "" {
		env["ANTHROPIC_BASE_URL"] = v["base_url"]
	}
	return env
}

func (Runner) Tool(name string) (string, bool) { return strings.CutPrefix(name, "mcp__"+Server+"__") }

var flaky = regexp.MustCompile(`(?i)EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|can't reach the API|connection error|overloaded|API Error: 5\d\d`)

func (Runner) Transient(text string) bool { return flaky.MatchString(text) }

func (Runner) Argv(t llm.Turn) []string {
	settings, _ := json.Marshal(map[string]any{"permissions": map[string]string{"defaultMode": "bypassPermissions"}})
	mcp, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{Server: map[string]any{"command": t.MCP, "args": []string{"mcp"}}}})
	argv := []string{"claude", "-p", t.Prompt, "--verbose", "--output-format", "stream-json",
		"--settings", string(settings), "--mcp-config", string(mcp)}
	if t.Model != "" {
		argv = append(argv, "--model", t.Model)
	}
	if t.Instructions != "" {
		argv = append(argv, "--append-system-prompt", t.Instructions)
	}
	if t.Session != "" {
		argv = append(argv, "--resume", t.Session)
	}
	return argv
}

func (Runner) Transcript(line string) string {
	var d struct {
		Session string `json:"session_id"`
	}
	json.Unmarshal([]byte(line), &d)
	return d.Session
}

func (Runner) Events(line string) []contract.Event { return events(line) }

// Quiet system subtypes: nothing a reader of the transcript needs.
var quiet = map[string]bool{"thinking_tokens": true, "task_updated": true, "background_tasks_changed": true,
	"hook_started": true, "hook_response": true}

type usage struct {
	Input       int64 `json:"input_tokens"`
	Output      int64 `json:"output_tokens"`
	CacheCreate int64 `json:"cache_creation_input_tokens"`
	Total       int64 `json:"total_tokens"`
	Tools       int64 `json:"tool_uses"`
	Duration    int64 `json:"duration_ms"`
}

// The events in one line of output; a line that is not stream-json is a notice.
func events(line string) []contract.Event {
	var d struct {
		Type, Subtype, Result, Status, Description, Summary string
		IsError                                             bool   `json:"is_error"`
		Parent                                              string `json:"parent_tool_use_id"`
		ToolUseID                                           string `json:"tool_use_id"`
		Agent                                               string `json:"subagent_type"`
		LastTool                                            string `json:"last_tool_name"`
		Duration                                            int64  `json:"duration_ms"`
		Usage                                               usage  `json:"usage"`
		Message                                             struct {
			Content []struct {
				Type, Text, Thinking, Name, ID string
				ToolUseID                      string          `json:"tool_use_id"`
				Input                          json.RawMessage `json:"input"`
				Content                        json.RawMessage `json:"content"`
			} `json:"content"`
		} `json:"message"`
	}
	if json.Unmarshal([]byte(line), &d) != nil {
		if strings.TrimSpace(line) == "" {
			return nil
		}
		return []contract.Event{{Kind: "notice", Content: line}}
	}
	var out []contract.Event
	switch d.Type {
	case "system":
		switch {
		case quiet[d.Subtype]:
		case d.Subtype == "task_started" || d.Subtype == "task_progress" || d.Subtype == "task_notification":
			if d.ToolUseID == "" {
				break
			}
			t := task{State: strings.TrimPrefix(d.Subtype, "task_"), Status: d.Status, Type: d.Agent,
				Summary: d.Summary, Tokens: d.Usage.Total, Tools: d.Usage.Tools, Duration: d.Usage.Duration, LastTool: d.LastTool}
			if d.Subtype == "task_progress" {
				t.Activity = d.Description
			} else {
				t.Description = d.Description
			}
			b, _ := json.Marshal(t)
			out = append(out, contract.Event{Kind: "task", ToolID: d.ToolUseID, Content: string(b), Parent: d.Parent})
		default:
			out = append(out, contract.Event{Kind: "status", Content: d.Subtype})
		}
	case "assistant", "user":
		for _, b := range d.Message.Content {
			switch b.Type {
			case "text":
				out = append(out, contract.Event{Kind: "message", Content: b.Text, Parent: d.Parent})
			case "thinking":
				out = append(out, contract.Event{Kind: "thinking", Content: b.Thinking, Parent: d.Parent})
			case "tool_use":
				out = append(out, contract.Event{Kind: "tool_use", Tool: b.Name, ToolID: b.ID, Content: string(b.Input), Parent: d.Parent})
			case "tool_result":
				out = append(out, contract.Event{Kind: "tool_result", ToolID: b.ToolUseID, Content: text(b.Content), Parent: d.Parent})
			}
		}
	case "result":
		kind := "result"
		if d.IsError {
			kind = "error"
		}
		// Cache reads are left out: each turn re-reads the whole context, which would count it again every time.
		u := d.Usage
		meta, _ := json.Marshal(struct {
			Duration int64 `json:"duration_ms,omitempty"`
			Tokens   int64 `json:"tokens,omitempty"`
		}{d.Duration, u.Input + u.Output + u.CacheCreate})
		ev := contract.Event{Kind: kind, Content: d.Result}
		if string(meta) != "{}" {
			ev.Meta = meta
		}
		out = append(out, ev)
	}
	return out
}

// A sub-agent's lifecycle, as the task event's content.
type task struct {
	State       string `json:"state"`
	Status      string `json:"status,omitempty"`
	Type        string `json:"type,omitempty"`
	Description string `json:"description,omitempty"`
	Activity    string `json:"activity,omitempty"`
	Summary     string `json:"summary,omitempty"`
	Tokens      int64  `json:"tokens,omitempty"`
	Tools       int64  `json:"tools,omitempty"`
	Duration    int64  `json:"duration_ms,omitempty"`
	LastTool    string `json:"last_tool,omitempty"`
}

func text(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct{ Type, Text string }
	_ = json.Unmarshal(raw, &parts)
	var b []string
	for _, p := range parts {
		b = append(b, p.Text)
	}
	return strings.Join(b, "\n")
}

var agentID = regexp.MustCompile(`agentId: (\w+)`)

// The prompt that has the main agent pass a message to the sub-agent its Task call to started.
func (Runner) Relay(events []contract.Event, to, prompt string) (string, error) {
	name, agent := "sub-agent", ""
	for _, ev := range events {
		switch {
		case ev.Kind == "tool_use" && ev.ToolID == to:
			var in struct {
				Description string `json:"description"`
				Type        string `json:"subagent_type"`
			}
			json.Unmarshal([]byte(ev.Content), &in)
			if in.Description != "" {
				name = in.Description
			} else if in.Type != "" {
				name = in.Type
			}
		case ev.Kind == "tool_result" && ev.ToolID == to:
			if m := agentID.FindStringSubmatch(ev.Content); m != nil {
				agent = m[1]
			}
		}
	}
	if agent == "" {
		return "", fmt.Errorf("that sub-agent cannot be reached yet")
	}
	return fmt.Sprintf("The user wrote to your sub-agent \"%s\". Continue it with SendMessage to: '%s', passing their message "+
		"as it is, then tell them what it answered.\n\nTheir message:\n%s", name, agent, prompt), nil
}
