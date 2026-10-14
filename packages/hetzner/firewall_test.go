package hetzner

import (
	"slices"
	"testing"
)

func TestRules(t *testing.T) {
	if got := lines(rules(nil)); !slices.Equal(got, []string{"in tcp 22 [0.0.0.0/0 ::/0]"}) {
		t.Fatalf("tunnel: %v", got)
	}
	got := lines(rules([]int{443, 80, 22}))
	want := []string{"in tcp 22 [0.0.0.0/0 ::/0]", "in tcp 443 [0.0.0.0/0 ::/0]", "in tcp 80 [0.0.0.0/0 ::/0]"}
	if !slices.Equal(got, want) {
		t.Fatalf("public: %v", got)
	}
}
