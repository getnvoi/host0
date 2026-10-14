package remote

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/workspace"
)

func sessionPath(id string) string { return "/sessions/" + url.PathEscape(id) }

func sessions() []*cobra.Command {
	var env string
	ls := &cobra.Command{
		Use:   "ls",
		Short: "Sessions, the most recently active first",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var ss []workspace.Summary
			if err := call("GET", "/sessions", nil, &ss); err != nil {
				return err
			}
			w := table()
			fmt.Fprintln(w, "ID\tENV\tSTATE\tQUEUED\tBY\tLAST\tTITLE")
			for _, s := range ss {
				if env != "" && s.Env != env {
					continue
				}
				title := s.Title
				if title == "" {
					title = clip(s.Prompt, 60)
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%d\t%s\t%s\t%s\n", s.ID, s.Env, s.State, s.Queued, s.By, s.Last.Local().Format(time.DateTime), title)
			}
			return w.Flush()
		},
	}
	ls.Flags().StringVar(&env, "env", "", "only this environment's")
	return []*cobra.Command{ls, {
		Use:   "show <id>",
		Short: "The session and everything it printed",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			var s workspace.Session
			if err := call("GET", sessionPath(args[0]), nil, &s); err != nil {
				return err
			}
			w := table()
			fmt.Fprintf(w, "id\t%s\nenv\t%s\nstate\t%s\nbranch\t%s\npreview\t%s\nturns\t%d\nby\t%s\nstarted\t%s\n",
				s.ID, s.Env, s.State, s.Branch, s.Preview, s.Turns, s.By, s.At.Local().Format(time.DateTime))
			if s.Title != "" {
				fmt.Fprintf(w, "title\t%s\n", s.Title)
			}
			if s.Error != "" {
				fmt.Fprintf(w, "error\t%s\n", s.Error)
			}
			if err := w.Flush(); err != nil {
				return err
			}
			fmt.Println()
			for _, ev := range s.Events {
				print(ev)
			}
			return nil
		},
	}, {
		Use:   "stop <id>",
		Short: "Stop the running turn",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return call("POST", sessionPath(args[0])+"/stop", nil, nil)
		},
	}, {
		Use:   "rm <id>",
		Short: "Remove the session and its sandbox; refused while it runs",
		Args:  cobra.ExactArgs(1),
		RunE:  func(_ *cobra.Command, args []string) error { return call("DELETE", sessionPath(args[0]), nil, nil) },
	}, changes(), logs(), queue()}
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func changes() *cobra.Command {
	var full bool
	cmd := &cobra.Command{
		Use:   "changes <id>",
		Short: "What the session changed against its environment's branch",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			var c workspace.Changes
			if err := call("GET", sessionPath(args[0])+"/changes", nil, &c); err != nil {
				return err
			}
			if full {
				fmt.Print(c.Patch)
				if c.Truncated {
					return fmt.Errorf("the patch is truncated")
				}
				return nil
			}
			w := table()
			for _, f := range c.Files {
				path := f.Path
				if f.OldPath != "" {
					path = f.OldPath + " → " + f.Path
				}
				fmt.Fprintf(w, "%s\t+%d\t-%d\t%s\n", f.Status, f.Added, f.Removed, path)
			}
			fmt.Fprintf(w, "against %s\t+%d\t-%d\t%d files\n", c.Base, c.Added, c.Removed, len(c.Files))
			return w.Flush()
		},
	}
	cmd.Flags().BoolVar(&full, "patch", false, "print the patch")
	return cmd
}

func logs() *cobra.Command {
	var follow bool
	cmd := &cobra.Command{
		Use:   "logs <id> [name]",
		Short: "The session's logs: without a name, which there are",
		Args:  cobra.RangeArgs(1, 2),
		RunE: func(_ *cobra.Command, args []string) error {
			if len(args) == 1 {
				var ls []workspace.Log
				if err := call("GET", sessionPath(args[0])+"/logs", nil, &ls); err != nil {
					return err
				}
				for _, l := range ls {
					fmt.Printf("%s  %s\n", l.Name, l.Kind)
				}
				return nil
			}
			path := sessionPath(args[0]) + "/logs/" + url.PathEscape(args[1])
			for offset := int64(0); ; time.Sleep(2 * time.Second) {
				res, err := send("GET", path+"?offset="+strconv.FormatInt(offset, 10), nil)
				if err != nil {
					return err
				}
				_, err = io.Copy(os.Stdout, res.Body)
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

func queue() *cobra.Command {
	cmd := &cobra.Command{Use: "queue", Short: "Messages waiting for the session's turn to end"}
	cmd.AddCommand(&cobra.Command{
		Use:   "ls <id>",
		Short: "The queued messages, numbered",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			var q []string
			if err := call("GET", sessionPath(args[0])+"/queue", nil, &q); err != nil {
				return err
			}
			for i, m := range q {
				fmt.Printf("%d  %s\n", i+1, m)
			}
			return nil
		},
	}, &cobra.Command{
		Use:   "rm <id> <n>",
		Short: "Withdraw message n, as queue ls numbers it",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			var q []string
			if err := call("GET", sessionPath(args[0])+"/queue", nil, &q); err != nil {
				return err
			}
			n, err := strconv.Atoi(args[1])
			if err != nil || n < 1 || n > len(q) {
				return fmt.Errorf("session %s has no queued message %s", args[0], args[1])
			}
			return call("DELETE", sessionPath(args[0])+"/queue/"+strconv.Itoa(n-1), map[string]string{"text": q[n-1]}, nil)
		},
	})
	return cmd
}
