package remote

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/workers"
	"github.com/getnvoi/host0/internal/workspace"
)

func init() {
	written["ls"] = status
	written["usage"] = usage
	written["preview"] = preview
}

func status() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "ls",
		Short: "The cluster now: its nodes, worker pools, workers and the plane's hosts",
		Args:  cobra.NoArgs,
		RunE: func(cc *cobra.Command, _ []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			c, err := client.Read[workers.Cluster](pl.Ls(cc.Context()))
			if err != nil {
				return err
			}
			if output != "" {
				return asJSON(cc.OutOrStdout(), output, c)
			}
			out := cc.OutOrStdout()
			fmt.Fprintf(out, "cluster %s, zone %s\n\n", c.Name, c.Zone)
			w := table(out)
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
	outputFlag(cmd, &output)
	return cmd
}

func usage() *cobra.Command {
	var days int64
	var by, output string
	cmd := &cobra.Command{
		Use:   "usage",
		Short: "Sessions, compute, pull requests and tokens over the last days",
		Args:  cobra.NoArgs,
		RunE: func(cc *cobra.Command, _ []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			q := &client.UsageParams{Days: &days}
			if by != "" {
				q.By = &by
			}
			u, err := client.Read[workspace.Usage](pl.Usage(cc.Context(), q))
			if err != nil {
				return err
			}
			if output != "" {
				return asJSON(cc.OutOrStdout(), output, u)
			}
			t := u.Totals
			out := cc.OutOrStdout()
			fmt.Fprintf(out, "%s to %s\n\n", u.From, u.To)
			w := table(out)
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
	cmd.Flags().Int64Var(&days, "days", 30, "how many days back, at most 365")
	cmd.Flags().StringVar(&by, "by", "", "one person's usage")
	outputFlag(cmd, &output)
	return cmd
}

// A link to host carrying a gate token; the bare host answers 401.
func previewLink(ctx context.Context, host string) (string, error) {
	pl, err := api()
	if err != nil {
		return "", err
	}
	l, err := client.Read[client.PreviewLink](pl.Preview(ctx, client.PreviewInput{Host: host}))
	return l.Url, err
}

// The preview link, or the bare host with why there is none.
func link(host string) string {
	u, err := previewLink(context.Background(), host)
	if err != nil {
		return "https://" + host + " (" + err.Error() + ")"
	}
	return u
}

func preview() *cobra.Command {
	var check bool
	cmd := &cobra.Command{
		Use:   "preview <host or link>",
		Short: "A 12-hour link to a preview; --check opens it as a visitor would",
		Long: "A 12-hour link to a preview; --check opens it as a visitor would.\n\n" +
			"Given a link h0 printed (env seed, session start), --check opens that link as it is.",
		Args: cobra.ExactArgs(1),
		RunE: func(cc *cobra.Command, args []string) error {
			host, u := target(args[0])
			if u == "" {
				var err error
				if u, err = previewLink(cc.Context(), host); err != nil {
					return err
				}
			}
			if check {
				return visit(host, u, cc.OutOrStdout())
			}
			fmt.Fprintln(cc.OutOrStdout(), u)
			return nil
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "the gate refuses no token, the link sets the cookie, the cookie opens the app")
	return cmd
}

// The host, and the link when arg is one h0 printed; a bare host has no link yet.
func target(arg string) (host, link string) {
	if l, err := url.Parse(arg); err == nil && l.Scheme == "https" && l.Host != "" {
		return l.Host, arg
	}
	return arg, ""
}

// nil is http.DefaultTransport; tests trust their own server with theirs.
var transport http.RoundTripper

var title = regexp.MustCompile(`(?is)<title>(.*?)</title>`)

// Visits host as a browser does: refused without a token, cookie from the link, the app with the cookie.
func visit(host, link string, out io.Writer) error {
	// A suspended sandbox resumes on the first request; that is the slowest answer a visitor waits for.
	client := &http.Client{Transport: transport, Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	get := func(url, cookie string) (*http.Response, string, error) {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, "", err
		}
		req.Header.Set("Accept", "text/html")
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		res, err := client.Do(req)
		if err != nil {
			return nil, "", err
		}
		defer res.Body.Close()
		b, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		return res, string(b), err
	}
	root := "https://" + host + "/"
	res, _, err := get(root, "")
	if err != nil {
		return err
	}
	if c := res.TLS; c != nil && len(c.PeerCertificates) > 0 {
		cert := c.PeerCertificates[0]
		fmt.Fprintf(out, "tls        %s, issued by %s, until %s\n", cert.Subject.CommonName, cert.Issuer.CommonName, cert.NotAfter.Format("2006-01-02"))
	}
	fmt.Fprintf(out, "no token   %s\n", res.Status)
	if res.StatusCode != http.StatusUnauthorized {
		return fmt.Errorf("%s answers %s without a token; the gate is open", host, res.Status)
	}
	res, _, err = get(link, "")
	if err != nil {
		return err
	}
	var cookie string
	for _, c := range res.Cookies() {
		if c.Name == "h0_token" {
			cookie = c.Name + "=" + c.Value
		}
	}
	fmt.Fprintf(out, "link       %s, cookie %t\n", res.Status, cookie != "")
	if cookie == "" {
		return fmt.Errorf("the link to %s answered %s and set no h0_token cookie", host, res.Status)
	}
	start := time.Now()
	res, body, err := get(root, cookie)
	if err != nil {
		return err
	}
	t := ""
	if m := title.FindStringSubmatch(body); m != nil {
		t = strings.TrimSpace(m[1])
	}
	fmt.Fprintf(out, "cookie     %s in %s, title %q\n", res.Status, time.Since(start).Round(time.Millisecond), t)
	if res.StatusCode != http.StatusOK {
		said := strings.TrimSpace(body)
		if len(said) > 300 {
			said = said[:300] + "…"
		}
		return fmt.Errorf("%s answers %s with the cookie: %q", host, res.Status, said)
	}
	return nil
}

// The -o of a hand-written read: json prints the plane's answer as it is, like a generated command's.
func outputFlag(cmd *cobra.Command, output *string) {
	cmd.Flags().StringVarP(output, "output", "o", "", "json: the plane's answer as it is")
}

func asJSON(w io.Writer, output string, v any) error {
	if output != "json" {
		return fmt.Errorf("-o %s: want json", output)
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(b))
	return err
}
