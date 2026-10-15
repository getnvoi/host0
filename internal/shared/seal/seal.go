// AES-256-GCM under the 32-byte sealing key: "h0-sealed:1:" then base64(nonce|ciphertext), a fresh nonce per seal.
package seal

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
)

const (
	Size   = 32
	prefix = "h0-sealed:1:"
)

func Mint() []byte {
	k := make([]byte, Size)
	rand.Read(k)
	return k
}

func aead(key []byte) (cipher.AEAD, error) {
	if len(key) != Size {
		return nil, fmt.Errorf("the sealing key is %d bytes, not %d", len(key), Size)
	}
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

func Seal(key, plain []byte) ([]byte, error) {
	g, err := aead(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	raw := g.Seal(nonce, nonce, plain, nil)
	out := make([]byte, len(prefix)+base64.StdEncoding.EncodedLen(len(raw)))
	copy(out, prefix)
	base64.StdEncoding.Encode(out[len(prefix):], raw)
	return out, nil
}

var ErrOpen = errors.New("does not open with this sealing key: another key sealed it, or it was altered")

func Open(key, sealed []byte) ([]byte, error) {
	g, err := aead(key)
	if err != nil {
		return nil, err
	}
	if !bytes.HasPrefix(sealed, []byte(prefix)) {
		return nil, errors.New("not sealed: no " + prefix + " prefix")
	}
	raw, err := base64.StdEncoding.DecodeString(string(sealed[len(prefix):]))
	if err != nil {
		return nil, fmt.Errorf("sealed value is not base64: %w", err)
	}
	if len(raw) < g.NonceSize()+g.Overhead() {
		return nil, ErrOpen
	}
	plain, err := g.Open(nil, raw[:g.NonceSize()], raw[g.NonceSize():], nil)
	if err != nil {
		return nil, ErrOpen
	}
	return plain, nil
}
