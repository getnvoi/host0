package remote

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/workers"
	"github.com/getnvoi/host0/internal/workspace"
)

func status() *cobra.Command {
	return &cobra.Command{
		Use:   "ls",
		Short: "The cluster now: its nodes, worker pools, workers and the plane's hosts",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var c workers.Cluster
			if err := call("GET", "/cluster", nil, &c); err != nil {
				return err
			}
			fmt.Printf("cluster %s, zone %s\n\n", c.Name, c.Zone)
			w := table(os.Stdout)
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
			var u workspace.Usage
			if err := call("GET", "/usage?"+q.Encode(), nil, &u); err != nil {
				return err
			}
			t := u.Totals
			fmt.Printf("%s to %s\n\n", u.From, u.To)
			w := table(os.Stdout)
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

func browsers() *cobra.Command {
	return &cobra.Command{
		Use:   "browsers",
		Short: "Browsers signed in to the web UI",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var bs []auth.Browser
			if err := call("GET", "/browsers", nil, &bs); err != nil {
				return err
			}
			w := table(os.Stdout)
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

func pods() *cobra.Command {
	var node string
	cmd := &cobra.Command{
		Use:   "pods",
		Short: "Every pod in the cluster, or one node's",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var ps []kube.Pod
			if err := call("GET", "/cluster/pods?node="+url.QueryEscape(node), nil, &ps); err != nil {
				return err
			}
			w := table(os.Stdout)
			fmt.Fprintln(w, "NAMESPACE\tPOD\tNODE\tPHASE\t")
			for _, p := range ps {
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t\n", p.Namespace, p.Name, p.Node, p.Phase)
			}
			return w.Flush()
		},
	}
	cmd.Flags().StringVar(&node, "node", "", "only this node's pods")
	return cmd
}

func podLogs() *cobra.Command {
	var container string
	var tail int
	cmd := &cobra.Command{
		Use:   "logs <namespace>/<pod>",
		Short: "The end of a cluster pod's log",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, pod, ok := strings.Cut(args[0], "/")
			if !ok {
				return fmt.Errorf("%s: want <namespace>/<pod>, as hz pods prints them", args[0])
			}
			q := url.Values{"tail": {strconv.Itoa(tail)}, "container": {container}}
			var out struct{ Log string }
			if err := call("GET", "/cluster/pods/"+url.PathEscape(ns)+"/"+url.PathEscape(pod)+"/log?"+q.Encode(), nil, &out); err != nil {
				return err
			}
			fmt.Print(out.Log)
			return nil
		},
	}
	cmd.Flags().StringVarP(&container, "container", "c", "", "the container, when the pod has several")
	cmd.Flags().IntVar(&tail, "tail", 200, "lines from the end")
	return cmd
}
