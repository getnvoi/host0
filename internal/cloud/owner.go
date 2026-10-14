package cloud

import "github.com/getnvoi/host0/internal/shared/naming"

// Every resource hz creates carries OwnerKey=Cluster.Prefix(), as a label or as the tag Cluster.Owner().
const OwnerKey = "hz/owner"

func Owner(c naming.Cluster) map[string]string { return map[string]string{OwnerKey: c.Prefix()} }

// The label selector for Owner.
func OwnerSelector(c naming.Cluster) string { return OwnerKey + "=" + c.Prefix() }

// The one item of items named name, exactly; a provider's name filter may match more.
func Exact[T any](items []T, name func(T) string, want string) (T, bool) {
	for _, it := range items {
		if name(it) == want {
			return it, true
		}
	}
	var zero T
	return zero, false
}
