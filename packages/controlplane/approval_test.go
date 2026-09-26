package controlplane

import "testing"

func TestFailed(t *testing.T) {
	for line, want := range map[string]bool{
		"push_branch: failed: exit 128":                         true,
		"create_pull_request: push failed: exit 1":              true,
		"create_pull_request: opened https://x/pull/1":          false,
		"navigate_preview: the preview shows /checkout: failed": false,
	} {
		if failed(line) != want {
			t.Errorf("%q: %v", line, !want)
		}
	}
}
