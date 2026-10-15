package workspace

import "testing"

func TestFailed(t *testing.T) {
	for line, want := range map[string]bool{
		"session_push: failed: push h0/x: exit 128":     true,
		"session_pr: failed: no session x":              true,
		`session_pr: {"url":"https://x/pull/1"}`:        false,
		`session_navigate: {"path":"/checkout/failed"}`: false,
	} {
		if failed(line) != want {
			t.Errorf("%q: %v", line, !want)
		}
	}
}
