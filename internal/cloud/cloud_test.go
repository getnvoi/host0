package cloud

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

func TestInbound(t *testing.T) {
	if got := Inbound(nil); !slices.Equal(got, []int{22}) {
		t.Fatalf("tunnel: %v", got)
	}
	if got := Inbound([]int{443, 80, 22}); !slices.Equal(got, []int{22, 80, 443}) {
		t.Fatalf("public: %v", got)
	}
}

func TestRetryEndsInTheProvidersError(t *testing.T) {
	locked := &Error{Provider: "hetzner", Method: "DELETE", Path: "/networks/1", Status: 409, Message: "network is in use (resource_in_use)"}
	n := 0
	none := func(context.Context, time.Duration) error { return nil }
	err := Retry(context.Background(), 4, time.Second, none, func(*Error) bool { return true }, func() error { n++; return locked })
	if n != 4 || !errors.Is(err, locked) || err.Error() != "hetzner DELETE /networks/1: 409 network is in use (resource_in_use)" {
		t.Fatalf("%d attempts, %v", n, err)
	}
	n = 0
	other := errors.New("dial tcp: no route")
	if err := Retry(context.Background(), 4, time.Second, none, func(*Error) bool { return true }, func() error { n++; return other }); n != 1 || err != other {
		t.Fatalf("a transport error is retried: %d, %v", n, err)
	}
}
