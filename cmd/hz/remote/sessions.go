package remote

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/workspace"
)

func init() {
	for path, c := range map[string]func() *cobra.Command{
		"session start": sessionStart, "session say": sessionSay, "session follow": sessionFollow,
		"session queue rm": queueRm, "session log show": logShow,
	} {
		written[path] = c
	}
	groups["queue"] = "Messages waiting for the session's turn to end"
	groups["log"] = "The session's logs: its setup and each service"
	groups["terminal"] = "The session's terminals"
}

func sessionStart() *cobra.Command {
	return &cobra.Command{
		Use:   "start <env> <prompt>",
		Short: "Fork the environment's seed, run the prompt in it and follow the session",
		Args:  cobra.ExactArgs(2),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			body, err := jsonBody(map[string]string{"env": args[0], "prompt": args[1]})
			if err != nil {
				return err
			}
			s, err := client.Read[workspace.Session](pl.SessionStartWithBody(c.Context(), "application/json", body))
			if err != nil {
				return err
			}
			fmt.Fprintf(c.OutOrStdout(), "session %s on %s, preview %s\n", s.ID, s.Branch, link(s.Preview))
			return watch(c.Context(), c.OutOrStdout(), pl, s.ID, false)
		},
	}
}

func sessionSay() *cobra.Command {
	return &cobra.Command{
		Use:   "say <id> <prompt>",
		Short: "Send the session a message and follow it",
		Args:  cobra.ExactArgs(2),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			body, err := jsonBody(map[string]string{"prompt": args[1]})
			if err != nil {
				return err
			}
			if err := client.Done(pl.SessionSayWithBody(c.Context(), args[0], "application/json", body)); err != nil {
				return err
			}
			return watch(c.Context(), c.OutOrStdout(), pl, args[0], false)
		},
	}
}

func sessionFollow() *cobra.Command {
	return &cobra.Command{
		Use:   "follow <id>",
		Short: "Print the session's events as they come, until it stops for you",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			return watch(c.Context(), c.OutOrStdout(), pl, args[0], false)
		},
	}
}

// Prints the session's events until it rests. decided: an approval was just decided, so a session still awaiting
// approval with none left open is carrying the action out, and is watched on.
func watch(ctx context.Context, w io.Writer, pl *client.Client, id string, decided bool) error {
	seen := 0
	for {
		s, err := client.Read[workspace.Session](pl.SessionShow(ctx, id))
		if err != nil {
			return err
		}
		for _, ev := range s.Events[min(seen, len(s.Events)):] {
			print(w, ev)
		}
		seen = len(s.Events)
		switch s.State {
		case "awaiting_approval":
			open, err := asking(ctx, pl, s.ID)
			if err != nil {
				return err
			}
			if decided && !open {
				break
			}
			fmt.Fprintf(w, "session %s: %s %s\n", s.ID, s.State, s.Error)
			return nil
		case "idle", "failed":
			fmt.Fprintf(w, "session %s: %s %s\n", s.ID, s.State, s.Error)
			return nil
		}
		time.Sleep(2 * time.Second)
	}
}

// Whether the session has approvals still waiting for a decision.
func asking(ctx context.Context, pl *client.Client, sid string) (bool, error) {
	as, err := client.Read[[]workspace.Approval](pl.ApprovalLs(ctx, &client.ApprovalLsParams{Session: &sid}))
	return len(as) > 0, err
}

func print(w io.Writer, ev llm.Event) {
	c := strings.TrimSpace(ev.Content)
	if len(c) > 300 {
		c = c[:300] + "…"
	}
	switch ev.Kind {
	case "tool_use":
		fmt.Fprintf(w, "  → %s %s\n", ev.Tool, c)
	case "tool_result":
		fmt.Fprintf(w, "  ← %s\n", strings.ReplaceAll(c, "\n", " "))
	case "message", "result", "prompt", "error":
		fmt.Fprintf(w, "%s: %s\n", ev.Kind, c)
	case "notice":
		fmt.Fprintf(w, "  %s\n", c)
	}
}

func queueRm() *cobra.Command {
	return &cobra.Command{
		Use:   "rm <id> <n>",
		Short: "Withdraw message n, as queue ls numbers it from 1",
		Args:  cobra.ExactArgs(2),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			q, err := client.Read[[]string](pl.SessionQueueLs(c.Context(), args[0]))
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[1])
			if err != nil || n < 1 || n > len(q) {
				return fmt.Errorf("session %s has no queued message %s", args[0], args[1])
			}
			body, err := jsonBody(workspace.Withdrawal{Text: q[n-1]})
			if err != nil {
				return err
			}
			return client.Done(pl.SessionQueueRmWithBody(c.Context(), args[0], int64(n-1), "application/json", body))
		},
	}
}

func logShow() *cobra.Command {
	var follow bool
	cmd := &cobra.Command{
		Use:   "show <id> <name>",
		Short: "A log of the session: setup, or a service's",
		Args:  cobra.ExactArgs(2),
		RunE: func(c *cobra.Command, args []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			for offset := int64(0); ; time.Sleep(2 * time.Second) {
				res, err := client.OK(pl.SessionLogShow(c.Context(), args[0], args[1], &client.SessionLogShowParams{Offset: &offset}))
				if err != nil {
					return err
				}
				_, err = io.Copy(c.OutOrStdout(), res.Body)
				res.Body.Close()
				if err != nil {
					return err
				}
				if offset, err = strconv.ParseInt(res.Header.Get("X-Offset"), 10, 64); err != nil {
					return fmt.Errorf("X-Offset %q: %w", res.Header.Get("X-Offset"), err)
				}
				if !follow {
					return nil
				}
			}
		},
	}
	cmd.Flags().BoolVarP(&follow, "follow", "f", false, "keep printing what is written")
	return cmd
}
