package publicdns

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Resolvers nobody answers on are unreachable at once, not a host that is not published yet.
func TestPublishedUnreachable(t *testing.T) {
	was := Resolvers
	Resolvers = []string{"127.0.0.1:9"}
	t.Cleanup(func() { Resolvers = was })
	start := time.Now()
	err := Published(context.Background(), "example.invalid", time.Minute)
	if !errors.Is(err, ErrUnreachable) || time.Since(start) > 10*time.Second {
		t.Fatalf("%v after %s", err, time.Since(start))
	}
}
