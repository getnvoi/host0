package remote

import (
	"fmt"
	"io"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/workspace"
)

func init() {
	written["approval show"] = approvalShow
	written["approval approve"] = func() *cobra.Command { return decide("approve") }
	written["approval deny"] = func() *cobra.Command { return decide("deny") }
}

func approvalShow() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "show <id>",
		Short: "One approval in full, decided or not",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			a, err := client.Read[workspace.Approval](pl.ApprovalShow(c.Context(), args[0]))
			if err != nil {
				return err
			}
			if output != "" {
				return asJSON(c.OutOrStdout(), output, a)
			}
			showApproval(c.OutOrStdout(), a)
			return nil
		},
	}
	outputFlag(cmd, &output)
	return cmd
}

// approve or deny: the decision, then the session followed while it carries the action out.
func decide(d string) *cobra.Command {
	return &cobra.Command{
		Use:   d + " <id>",
		Short: map[string]string{"approve": "Carry the action out", "deny": "Refuse the action"}[d] + ", and follow the session",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			call := pl.ApprovalApprove
			if d == "deny" {
				call = pl.ApprovalDeny
			}
			a, err := client.Read[workspace.Approval](call(c.Context(), args[0]))
			if err != nil {
				return err
			}
			fmt.Fprintf(c.OutOrStdout(), "%s %s: %s\n", a.Tool, a.ID, a.State)
			return watch(c.Context(), c.OutOrStdout(), pl, a.Session, true)
		},
	}
}

func showApproval(w io.Writer, a workspace.Approval) {
	fmt.Fprintf(w, "id       %s\nsession  %s\ntool     %s\nstate    %s\nasked    %s\n", a.ID, a.Session, a.Tool, a.State,
		a.At.Format(time.RFC3339))
	if !a.Decided.IsZero() {
		fmt.Fprintf(w, "decided  %s by %s\n", a.Decided.Format(time.RFC3339), a.By)
	}
	if a.Outcome != "" {
		fmt.Fprintf(w, "outcome  %s\n", a.Outcome)
	}
	fmt.Fprintf(w, "input\n%s\n", a.Input)
}
