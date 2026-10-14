package remote

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/hz/local"
)

// hz as cmd/hz builds it.
func root() *cobra.Command {
	r := &cobra.Command{Use: "hz"}
	r.AddCommand(local.Cluster(), local.Machine())
	Attach(r)
	return r
}

// Every operation of the spec is a command: its own, or the hand-written ones its x-hz.by names.
func TestEveryOperationHasACommand(t *testing.T) {
	r := root()
	for _, o := range operations {
		paths := o.HZ.By
		if len(paths) == 0 {
			paths = []string{strings.ReplaceAll(o.ID, ".", " ")}
		}
		for _, p := range paths {
			if c, rest, err := r.Find(strings.Fields(p)); err != nil || len(rest) > 0 || c.CommandPath() != "hz "+p {
				t.Errorf("%s %s (%s): no command hz %s", o.Method, o.Route, o.ID, p)
			}
		}
	}
}
