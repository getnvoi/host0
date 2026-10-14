package remote

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/shared/contract"
	"github.com/getnvoi/host0/shared/state"
)

func status() *cobra.Command {
	return &cobra.Command{
		Use:   "ls",
		Short: "The cluster now: its nodes, worker pools, workers and the plane's hosts",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var c contract.Cluster
			if err := call("GET", "/cluster", nil, &c); err != nil {
				return err
			}
			fmt.Printf("cluster %s, zone %s\n\n", c.Name, c.Zone)
			w := table()
			fmt.Fprintln(w, "NODE\tROLES\tREADY\tAGE\tADDRESSES\tPROVIDER ID")
			for _, n := range c.Nodes {
				fmt.Fprintf(w, "%s\t%s\t%t\t%s\t%s\t%s\n", n.Name, strings.Join(n.Roles, ","), n.Ready,
					time.Since(n.Created).Round(time.Second), strings.Join(n.Addresses, ","), n.ProviderID)
			}
			fmt.Fprintln(w, "\nPOOL\tREPLICAS\tREADY\t")
			for _, p := range c.Pools {
				fmt.Fprintf(w, "%s\t%d\t%d\t\n", p.Name, p.Replicas, p.Ready)
			}
			fmt.Fprintln(w, "\nWORKER\tPOOL\tACTORS\t")
			for _, wk := range c.Workers {
				fmt.Fprintf(w, "%s\t%s\t%s\t\n", wk.Pod, wk.Pool, strings.Join(wk.Actors, ","))
			}
			fmt.Fprintln(w, "\nHOST\tEDGE\t\t")
			bad := 0
			for _, h := range c.Edge {
				edge := "routed"
				if h.Error != "" {
					edge, bad = h.Error, bad+1
				}
				fmt.Fprintf(w, "%s\t%s\t\t\n", h.Name, edge)
			}
			if err := w.Flush(); err != nil {
				return err
			}
			if bad > 0 {
				return fmt.Errorf("%d of the plane's hosts are not routed to the cluster", bad)
			}
			return nil
		},
	}
}

func whoami() *cobra.Command {
	return &cobra.Command{
		Use:   "me",
		Short: "The plane this CLI talks to",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			st, err := state.Load()
			if err != nil {
				return err
			}
			var out struct{ Cluster, Zone string }
			if err := call("GET", "/me", nil, &out); err != nil {
				return err
			}
			fmt.Printf("plane    %s\ncluster  %s\nzone     %s\n", st.URL, out.Cluster, out.Zone)
			return nil
		},
	}
}

func usage() *cobra.Command {
	var days int
	var by string
	cmd := &cobra.Command{
		Use:   "usage",
		Short: "Sessions, compute, pull requests and tokens over the last days",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			q := url.Values{"days": {strconv.Itoa(days)}}
			if by != "" {
				q.Set("by", by)
			}
			var u contract.Usage
			if err := call("GET", "/usage?"+q.Encode(), nil, &u); err != nil {
				return err
			}
			t := u.Totals
			fmt.Printf("%s to %s\n\n", u.From, u.To)
			w := table()
			fmt.Fprintf(w, "sessions\t%d\ncompute\t%.0f min\npull requests\t%d\ntokens\t%d\napprovals\t%d\napproval wait\t%s (median)\n",
				t.Sessions, t.Compute, t.PullRequests, t.Tokens, t.Approvals, time.Duration(t.ApprovalWaitMS)*time.Millisecond)
			if len(u.People) > 0 {
				fmt.Fprintf(w, "people\t%s\n", strings.Join(u.People, ", "))
			}
			fmt.Fprintln(w, "\nENVIRONMENT\tSESSIONS\tCOMPUTE\tPRS\tTOKENS")
			for _, e := range u.Environments {
				fmt.Fprintf(w, "%s\t%d\t%.0f min\t%d\t%d\n", e.Name, e.Sessions, e.Compute, e.PullRequests, e.Tokens)
			}
			return w.Flush()
		},
	}
	cmd.Flags().IntVar(&days, "days", 30, "how many days back")
	cmd.Flags().StringVar(&by, "by", "", "one person's usage")
	return cmd
}

// The agent credentials, which turns run on: one in use, the others kept or archived.
func configs() error {
	var cs []contract.LLMConfig
	if err := call("GET", "/llm/configs", nil, &cs); err != nil {
		return err
	}
	w := table()
	fmt.Fprintln(w, "LLM\tPROVIDER\tSTATE\tSTORED\tVALUES")
	for _, c := range cs {
		st := ""
		switch {
		case c.Archived != nil:
			st = "archived"
		case c.Main:
			st = "in use"
		}
		var vs []string
		for _, k := range keys(c.Values) {
			if c.Values[k] != "" {
				vs = append(vs, k+"="+c.Values[k])
			}
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", c.Name, c.Provider, st, strings.Join(c.Stored, ","), strings.Join(vs, " "))
	}
	return w.Flush()
}

func llm() *cobra.Command {
	cmd := &cobra.Command{Use: "llm", Short: "Agent credentials; hz credentials adds one"}
	var purge bool
	rm := &cobra.Command{
		Use:   "rm <name>",
		Short: "Archive the credential; --purge removes it",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := "/llm/configs/" + url.PathEscape(args[0])
			if purge {
				path += "?remove=1"
			}
			return call("DELETE", path, nil, nil)
		},
	}
	rm.Flags().BoolVar(&purge, "purge", false, "remove it rather than archive it")
	cmd.AddCommand(&cobra.Command{
		Use:   "ls",
		Short: "The agent credentials: which is in use, which are archived",
		Args:  cobra.NoArgs,
		RunE:  func(*cobra.Command, []string) error { return configs() },
	}, &cobra.Command{
		Use:   "use <name>",
		Short: "Run turns on this credential",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return call("POST", "/llm/configs/"+url.PathEscape(args[0])+"/main", nil, nil)
		},
	}, rm, &cobra.Command{
		Use:   "restore <name>",
		Short: "Bring an archived credential back",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return call("POST", "/llm/configs/"+url.PathEscape(args[0])+"/restore", nil, nil)
		},
	})
	return cmd
}

func browsers() *cobra.Command {
	return &cobra.Command{
		Use:   "browsers",
		Short: "Browsers signed in to the web UI",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var bs []contract.Browser
			if err := call("GET", "/browsers", nil, &bs); err != nil {
				return err
			}
			w := table()
			fmt.Fprintln(w, "LABEL\tSIGNED IN\tUNTIL")
			for _, b := range bs {
				fmt.Fprintf(w, "%s\t%s\t%s\n", b.Label, b.At.Local().Format(time.DateTime), b.Until.Local().Format(time.DateTime))
			}
			return w.Flush()
		},
	}
}

func logout() *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:   "logout [label]",
		Short: "Sign out the browsers under label, or with --all every browser",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			path := "/browsers"
			switch {
			case all && len(args) == 0:
			case !all && len(args) == 1:
				path += "/" + url.PathEscape(args[0])
			default:
				return fmt.Errorf("give a label, or --all")
			}
			var out struct{ Count int }
			if err := call("DELETE", path, nil, &out); err != nil {
				return err
			}
			fmt.Printf("signed out %d\n", out.Count)
			return nil
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "every browser")
	return cmd
}
