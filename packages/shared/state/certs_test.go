package state

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/getnvoi/host0/shared/seal"
)

func TestCertsRoundTrip(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	key := seal.Mint()
	if got, err := Certs("nvoi.to", key); got != nil || err != nil {
		t.Fatalf("no file: %v %v", got, err)
	}
	data := map[string][]byte{"k.Y2VydA": []byte("-----BEGIN PRIVATE KEY-----")}
	if err := SaveCerts("nvoi.to", key, data); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(CertsPath("nvoi.to"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v %v", info, err)
	}
	raw, _ := os.ReadFile(CertsPath("nvoi.to"))
	if strings.Contains(string(raw), "PRIVATE KEY") {
		t.Fatal("the file holds the key in the clear")
	}
	got, err := Certs("nvoi.to", key)
	if err != nil || string(got["k.Y2VydA"]) != "-----BEGIN PRIVATE KEY-----" {
		t.Fatalf("read back %v %v", got, err)
	}
	if _, err := Certs("nvoi.to", seal.Mint()); !errors.Is(err, seal.ErrOpen) || !strings.Contains(err.Error(), CertsPath("nvoi.to")) {
		t.Fatalf("opened under another key: %v", err)
	}
}
