// Anthropic's claude CLI: the command line for one turn and how its stream-json reads.
package claude

import (
	"encoding/json"
	"strings"

	"github.com/getnvoi/nvoi/shared/contract"
)

// The MCP server name; the CLI prefixes its tools with mcp__nvoi__.
const Server = "nvoi"

func Tool(name string) (string, bool) { return strings.CutPrefix(name, "mcp__"+Server+"__") }

type Turn struct {
	Prompt, Session, Model, Instructions, MCP string
	Resume                                    bool
}

func Argv(t Turn) []string {
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
	if t.Resume {
		return append(argv, "--resume", t.Session)
	}
	return append(argv, "--session-id", t.Session)
}

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
func Events(line string) []contract.Event {
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
