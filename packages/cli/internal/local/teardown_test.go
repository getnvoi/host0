package local

import (
	"context"
	"errors"
	"io"
	"slices"
	"testing"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/shared/naming"
)

type calls struct{ log []string }

type fakeCloud struct {
	cloud.Cloud
	c *calls
}

func (f fakeCloud) Destroy(context.Context, naming.Cluster) error {
	f.c.log = append(f.c.log, "servers")
	return nil
}

type edge struct {
	infra.Edge
	c *calls
}

func (f edge) Destroy(context.Context, naming.Cluster) error {
	f.c.log = append(f.c.log, "edge")
	return nil
}

func TestTeardownKeepsFirst(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	c := &calls{}
	e := &infra.Env{Cloud: fakeCloud{c: c}, Edge: edge{c: c}, Out: io.Discard}
	keep := func(context.Context, *infra.Env) error { c.log = append(c.log, "keep"); return nil }
	if err := teardown(context.Background(), e, keep); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.log, []string{"keep", "servers", "edge"}) {
		t.Fatalf("order %v", c.log)
	}

	c.log = nil
	failed := func(context.Context, *infra.Env) error {
		return errors.New("secret proxy-certs holds no certificate to keep")
	}
	if err := teardown(context.Background(), e, failed); err == nil || len(c.log) != 0 {
		t.Fatalf("a failed keep went on to %v (%v)", c.log, err)
	}
}
