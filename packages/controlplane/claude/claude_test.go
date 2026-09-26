package claude

import "testing"

func TestEvents(t *testing.T) {
	cases := map[string]string{
		`{"type":"system","subtype":"init"}`: "status",
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__nvoi__create_pull_request","id":"t1","input":{"title":"x"}}]}}`: "tool_use",
		`{"type":"result","result":"done"}`: "result",
		`not json`:                          "notice",
	}
	for line, kind := range cases {
		ev := Events(line)
		if len(ev) != 1 || ev[0].Kind != kind {
			t.Errorf("%s: got %+v, want %s", line, ev, kind)
		}
	}
	if name, ok := Tool("mcp__nvoi__create_pull_request"); !ok || name != "create_pull_request" {
		t.Errorf("Tool: %q %v", name, ok)
	}
}

func TestParent(t *testing.T) {
	ev := Events(`{"type":"assistant","parent_tool_use_id":"toolu_1","message":{"content":[{"type":"text","text":"hi"},` +
		`{"type":"thinking","thinking":"hm"}]}}`)
	if len(ev) != 2 || ev[0].Parent != "toolu_1" || ev[1].Kind != "thinking" || ev[1].Content != "hm" || ev[1].Parent != "toolu_1" {
		t.Fatalf("got %+v", ev)
	}
	ev = Events(`{"type":"user","parent_tool_use_id":"toolu_1","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"ok"}]}}`)
	if len(ev) != 1 || ev[0].Parent != "toolu_1" || ev[0].ToolID != "t2" || ev[0].Content != "ok" {
		t.Fatalf("got %+v", ev)
	}
	if ev := Events(`{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"text","text":"x"}]}}`); ev[0].Parent != "" {
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
		ev := Events(line)
		if len(ev) != 1 || ev[0].Kind != "task" || ev[0].ToolID != "toolu_1" || ev[0].Content != want {
			t.Errorf("%s: got %+v, want %s", line, ev, want)
		}
	}
	if ev := Events(`{"type":"system","subtype":"task_started","description":"x"}`); len(ev) != 0 {
		t.Errorf("task without tool_use_id: %+v", ev)
	}
	for _, sub := range []string{"thinking_tokens", "task_updated", "background_tasks_changed", "hook_started", "hook_response"} {
		if ev := Events(`{"type":"system","subtype":"` + sub + `"}`); len(ev) != 0 {
			t.Errorf("%s: %+v", sub, ev)
		}
	}
}

func TestResultMeta(t *testing.T) {
	ev := Events(`{"type":"result","result":"ok","duration_ms":1500,"usage":{"input_tokens":10,"output_tokens":20,` +
		`"cache_read_input_tokens":300,"cache_creation_input_tokens":4}}`)
	if len(ev) != 1 || string(ev[0].Meta) != `{"duration_ms":1500,"tokens":34}` {
		t.Fatalf("got %+v", ev)
	}
	if ev := Events(`{"type":"result","result":"ok","duration_ms":7}`); string(ev[0].Meta) != `{"duration_ms":7}` {
		t.Fatalf("no usage: %s", ev[0].Meta)
	}
}
