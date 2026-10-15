package state

import (
	"fmt"
	"os"
)

// The files under ~/.h0, as the install reads and writes them.
type Laptop struct{}

func (Laptop) Key() ([]byte, error)              { return Key() }
func (Laptop) SaveKey(k []byte) error            { return SaveKey(k) }
func (Laptop) KeyPath() string                   { return KeyPath() }
func (Laptop) CertsPath(zone string) string      { return CertsPath(zone) }
func (Laptop) SavePlane(url, token string) error { return Save(State{URL: url, Token: token}) }

func (Laptop) SaveCerts(zone string, key []byte, data map[string][]byte) error {
	return SaveCerts(zone, key, data)
}

func (Laptop) Certs(zone string) (map[string][]byte, error) {
	if _, err := os.Stat(CertsPath(zone)); err != nil {
		return nil, nil
	}
	key, err := Key()
	if err != nil {
		return nil, err
	}
	if key == nil {
		return nil, fmt.Errorf("%s is sealed with %s, which is not there", CertsPath(zone), KeyPath())
	}
	return Certs(zone, key)
}
