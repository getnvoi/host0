package seal

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	k := Mint()
	s, err := Seal(k, []byte("ghp_secret"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(s, []byte("ghp_secret")) || !strings.HasPrefix(string(s), prefix) {
		t.Fatalf("sealed form %q", s)
	}
	p, err := Open(k, s)
	if err != nil || string(p) != "ghp_secret" {
		t.Fatalf("open %q %v", p, err)
	}
}

func TestFreshNonce(t *testing.T) {
	k := Mint()
	a, _ := Seal(k, []byte("same"))
	b, _ := Seal(k, []byte("same"))
	ra, _ := base64.StdEncoding.DecodeString(string(a[len(prefix):]))
	rb, _ := base64.StdEncoding.DecodeString(string(b[len(prefix):]))
	if bytes.Equal(ra[:12], rb[:12]) || bytes.Equal(a, b) {
		t.Fatal("two seals share a nonce")
	}
}

func TestTamper(t *testing.T) {
	k := Mint()
	s, _ := Seal(k, []byte("value"))
	raw, _ := base64.StdEncoding.DecodeString(string(s[len(prefix):]))
	raw[len(raw)-1] ^= 1
	bad := append([]byte(prefix), base64.StdEncoding.EncodeToString(raw)...)
	if _, err := Open(k, bad); !errors.Is(err, ErrOpen) {
		t.Fatalf("tampered value opened: %v", err)
	}
}

func TestWrongKey(t *testing.T) {
	s, _ := Seal(Mint(), []byte("value"))
	if _, err := Open(Mint(), s); !errors.Is(err, ErrOpen) {
		t.Fatalf("opened under another key: %v", err)
	}
	if _, err := Open(Mint(), []byte(`{"plain":"json"}`)); err == nil {
		t.Fatal("plaintext opened")
	}
	if _, err := Seal(make([]byte, 16), nil); err == nil {
		t.Fatal("sealed with a 16-byte key")
	}
}
