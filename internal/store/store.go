// The plane's records: one JSON value per kind and id. files implements it on the control node's disk.
package store

type Store interface {
	Get(kind, id string, v any) error
	Put(kind, id string, v any) error
	Delete(kind, id string) error
	List(kind string, each func(decode func(any) error) error) error
}

type notFound struct{}

func (notFound) Error() string { return "not found" }

// What Get answers for an id it does not hold.
var ErrNotFound error = notFound{}
