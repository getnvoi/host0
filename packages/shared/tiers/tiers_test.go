package tiers

import "testing"

func TestPick(t *testing.T) {
	if got, err := Pick(Defaults, ""); err != nil || got.Name != "medium" {
		t.Fatalf("default: %v %v", got, err)
	}
	if got, err := Pick(Defaults, "large"); err != nil || got.CPU != "4" {
		t.Fatalf("large: %v %v", got, err)
	}
	if _, err := Pick(Defaults, "huge"); err == nil || err.Error() != `no tier "huge": small, medium, large` {
		t.Fatalf("huge: %v", err)
	}
}
