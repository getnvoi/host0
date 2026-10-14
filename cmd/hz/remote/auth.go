package remote

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/api/client"
)

func init() {
	written["open"] = open
	written["invite"] = invite
	written["logout"] = logout
}

func loginLink(ctx context.Context, label string) (string, error) {
	c, err := api()
	if err != nil {
		return "", err
	}
	l, err := client.Read[client.LoginLink](c.Invite(ctx, client.LoginLinkInput{Label: label}))
	return l.Url, err
}

func open() *cobra.Command {
	return &cobra.Command{
		Use:   "open",
		Short: "Sign this machine's browser in to the web UI",
		Args:  cobra.NoArgs,
		RunE: func(c *cobra.Command, _ []string) error {
			url, err := loginLink(c.Context(), me())
			if err != nil {
				return err
			}
			if err := exec.Command("open", url).Run(); err != nil {
				if err := exec.Command("xdg-open", url).Run(); err != nil {
					fmt.Fprintln(c.OutOrStdout(), url)
				}
			}
			return nil
		},
	}
}

// The local user's name: what the plane records this browser's sessions and decisions under.
func me() string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	if name := os.Getenv("USER"); name != "" {
		return name
	}
	host, _ := os.Hostname()
	return host
}

func invite() *cobra.Command {
	return &cobra.Command{
		Use:   "invite <name>",
		Short: "A sign-in link for someone else's browser, valid 60 seconds and once",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			url, err := loginLink(c.Context(), args[0])
			if err == nil {
				fmt.Fprintln(c.OutOrStdout(), url)
			}
			return err
		},
	}
}

func logout() *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:   "logout [label]",
		Short: "Sign out the browsers under label, or with --all every browser",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cc *cobra.Command, args []string) error {
			c, err := api()
			if err != nil {
				return err
			}
			var out client.SignedOut
			switch {
			case all && len(args) == 0:
				out, err = client.Read[client.SignedOut](c.LogoutAll(cc.Context()))
			case !all && len(args) == 1:
				out, err = client.Read[client.SignedOut](c.Logout(cc.Context(), args[0]))
			default:
				return fmt.Errorf("give a label, or --all")
			}
			if err != nil {
				return err
			}
			fmt.Fprintf(cc.OutOrStdout(), "signed out %d\n", out.Count)
			return nil
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "every browser")
	return cmd
}
