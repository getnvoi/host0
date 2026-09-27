package claude

import (
	"reflect"
	"strings"
	"testing"

	"github.com/getnvoi/nvoi/shared/contract"
)

func TestEvents(t *testing.T) {
	cases := map[string]string{
		`{"type":"system","subtype":"init"}`: "status",
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__nvoi__create_pull_request","id":"t1","input":{"title":"x"}}]}}`: "tool_use",
		`{"type":"result","result":"done"}`: "result",
		`not json`:                          "notice",
	}
	for line, kind := range cases {
		ev := events(line)
		if len(ev) != 1 || ev[0].Kind != kind {
			t.Errorf("%s: got %+v, want %s", line, ev, kind)
		}
	}
	if name, ok := (Runner{}).Tool("mcp__nvoi__create_pull_request"); !ok || name != "create_pull_request" {
		t.Errorf("Tool: %q %v", name, ok)
	}
}

func TestParent(t *testing.T) {
	ev := events(`{"type":"assistant","parent_tool_use_id":"toolu_1","message":{"content":[{"type":"text","text":"hi"},` +
		`{"type":"thinking","thinking":"hm"}]}}`)
	if len(ev) != 2 || ev[0].Parent != "toolu_1" || ev[1].Kind != "thinking" || ev[1].Content != "hm" || ev[1].Parent != "toolu_1" {
		t.Fatalf("got %+v", ev)
	}
	ev = events(`{"type":"user","parent_tool_use_id":"toolu_1","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"ok"}]}}`)
	if len(ev) != 1 || ev[0].Parent != "toolu_1" || ev[0].ToolID != "t2" || ev[0].Content != "ok" {
		t.Fatalf("got %+v", ev)
	}
	if ev := events(`{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"text","text":"x"}]}}`); ev[0].Parent != "" {
		t.Fatalf("null parent: %+v", ev)
	}
}

func TestTasks(t *testing.T) {
	cases := map[string]string{
		`{"type":"system","subtype":"task_started","tool_use_id":"toolu_1","description":"Explore","subagent_type":"Explore"}`: `{"state":"started","type":"Explore","description":"Explore"}`,
		`{"type":"system","subtype":"task_progress","tool_use_id":"toolu_1","description":"Reading x.go","last_tool_name":"Read",` +
			`"usage":{"total_tokens":1200,"tool_uses":3,"duration_ms":4000}}`: `{"state":"progress","activity":"Reading x.go","tokens":1200,"tools":3,"duration_ms":4000,"last_tool":"Read"}`,
		`{"type":"system","subtype":"task_notification","tool_use_id":"toolu_1","status":"completed","summary":"done"}`: `{"state":"notification","status":"completed","summary":"done"}`,
	}
	for line, want := range cases {
		ev := events(line)
		if len(ev) != 1 || ev[0].Kind != "task" || ev[0].ToolID != "toolu_1" || ev[0].Content != want {
			t.Errorf("%s: got %+v, want %s", line, ev, want)
		}
	}
	if ev := events(`{"type":"system","subtype":"task_started","description":"x"}`); len(ev) != 0 {
		t.Errorf("task without tool_use_id: %+v", ev)
	}
	for _, sub := range []string{"thinking_tokens", "task_updated", "background_tasks_changed", "hook_started", "hook_response"} {
		if ev := events(`{"type":"system","subtype":"` + sub + `"}`); len(ev) != 0 {
			t.Errorf("%s: %+v", sub, ev)
		}
	}
}

func TestResultMeta(t *testing.T) {
	ev := events(`{"type":"result","result":"ok","duration_ms":1500,"usage":{"input_tokens":10,"output_tokens":20,` +
		`"cache_read_input_tokens":300,"cache_creation_input_tokens":4}}`)
	if len(ev) != 1 || string(ev[0].Meta) != `{"duration_ms":1500,"tokens":34}` {
		t.Fatalf("got %+v", ev)
	}
	if ev := events(`{"type":"result","result":"ok","duration_ms":7}`); string(ev[0].Meta) != `{"duration_ms":7}` {
		t.Fatalf("no usage: %s", ev[0].Meta)
	}
}

func TestRelay(t *testing.T) {
	events := []contract.Event{
		{Kind: "tool_use", Tool: "Task", ToolID: "toolu_1", Content: `{"description":"Audit the api","subagent_type":"Explore"}`},
	}
	if _, err := (Runner{}).Relay(events, "toolu_1", "hi"); err == nil || err.Error() != "that sub-agent cannot be reached yet" {
		t.Fatalf("before its result: %v", err)
	}
	events = append(events, contract.Event{Kind: "tool_result", ToolID: "toolu_1", Content: "Found it.\nagentId: a1b2c3 (use SendMessage)"})
	got, err := (Runner{}).Relay(events, "toolu_1", "look at auth too")
	want := "The user wrote to your sub-agent \"Audit the api\". Continue it with SendMessage to: 'a1b2c3', passing their " +
		"message as it is, then tell them what it answered.\n\nTheir message:\nlook at auth too"
	if err != nil || got != want {
		t.Fatalf("got %q %v", got, err)
	}
	events[0].Content = `{"subagent_type":"Explore"}`
	if got, _ := (Runner{}).Relay(events, "toolu_1", "x"); !strings.Contains(got, `sub-agent "Explore"`) {
		t.Fatalf("by type: %q", got)
	}
	events[0].Content = `{}`
	if got, _ := (Runner{}).Relay(events, "toolu_1", "x"); !strings.Contains(got, `sub-agent "sub-agent"`) {
		t.Fatalf("unnamed: %q", got)
	}
}

func TestEnv(t *testing.T) {
	got := (Runner{}).Env(map[string]string{"kind": "bearer", "token": "k", "base_url": "https://api.z.ai/api/anthropic"})
	want := map[string]string{"ANTHROPIC_AUTH_TOKEN": "k", "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic", "IS_SANDBOX": "1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
}
