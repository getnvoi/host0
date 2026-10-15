package remote

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/h0/local"
)

// h0 as cmd/h0 builds it.
func root() *cobra.Command {
	r := &cobra.Command{Use: "h0"}
	r.AddCommand(local.Cluster(), local.Machine())
	Attach(r)
	return r
}

// Every operation of the spec is a command: its own, or the hand-written ones its x-h0.by names.
func TestEveryOperationHasACommand(t *testing.T) {
	r := root()
	for _, o := range operations {
		paths := o.H0.By
		if o.H0.Output != "" {
			paths = append(paths, strings.ReplaceAll(o.ID, ".", " "))
		}
		for _, p := range paths {
			if c, rest, err := r.Find(strings.Fields(p)); err != nil || len(rest) > 0 || c.CommandPath() != "h0 "+p {
				t.Errorf("%s %s (%s): no command h0 %s", o.Method, o.Route, o.ID, p)
			}
		}
	}
}
