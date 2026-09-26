package boxd

import (
	"bufio"
	"encoding/json"
	"io"
)

// Parked is every tool call's answer: the plane performs it after the turn and reports the outcome in the next.
const Parked = "Queued. This action is performed for you once your turn ends and you will be told the outcome. " +
	"End your turn now with a one-line summary of what you asked for."

// A stdio MCP server listing tools and answering every call with Parked.
func MCP(tools json.RawMessage, in io.Reader, out io.Writer) error {
	if len(tools) == 0 {
		tools = json.RawMessage("[]")
	}
	enc := json.NewEncoder(out)
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		var msg struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		if json.Unmarshal(sc.Bytes(), &msg) != nil || msg.ID == nil {
			continue
		}
		var result any = map[string]any{}
		switch msg.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": "2024-11-05", "capabilities": map[string]any{"tools": map[string]any{}},
				"serverInfo": map[string]string{"name": "nvoi", "version": "1"}}
		case "tools/list":
			result = map[string]any{"tools": tools}
		case "tools/call":
			result = map[string]any{"content": []map[string]string{{"type": "text", "text": Parked}}}
		}
		if err := enc.Encode(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "result": result}); err != nil {
			return err
		}
	}
	return sc.Err()
}
