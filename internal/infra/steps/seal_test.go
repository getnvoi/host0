package steps

import (
	"bytes"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/shared/seal"
)

func TestSealKey(t *testing.T) {
	a, b := seal.Mint(), seal.Mint()
	for _, c := range []struct {
		name           string
		local, cluster []byte
		want           []byte
		fails          string
	}{
		{"both equal", a, bytes.Clone(a), a, ""},
		{"only local", a, nil, a, ""},
		{"only cluster", nil, b, b, ""},
		{"differ", a, b, nil, "differs from the sealing key in the cluster"},
		{"cluster short", nil, []byte("short"), nil, "seal is 5 bytes"},
	} {
		got, err := sealKey(c.local, c.cluster, "~/.hz/key")
		if c.fails != "" {
			if err == nil || !strings.Contains(err.Error(), c.fails) {
				t.Errorf("%s: %v, want %q", c.name, err, c.fails)
			}
			continue
		}
		if err != nil || !bytes.Equal(got, c.want) {
			t.Errorf("%s: %x %v", c.name, got, err)
		}
	}
	got, err := sealKey(nil, nil, "~/.hz/key")
	if err != nil || len(got) != seal.Size {
		t.Fatalf("neither: %x %v", got, err)
	}
}
