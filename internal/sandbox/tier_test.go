package sandbox

import "testing"

func TestPick(t *testing.T) {
	if got, err := Pick(DefaultTiers, ""); err != nil || got.Name != "medium" {
		t.Fatalf("default: %v %v", got, err)
	}
	if got, err := Pick(DefaultTiers, "large"); err != nil || got.CPU != "4" {
		t.Fatalf("large: %v %v", got, err)
	}
	if _, err := Pick(DefaultTiers, "huge"); err == nil || err.Error() != `no tier "huge": small, medium, large` {
		t.Fatalf("huge: %v", err)
	}
}
