package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/h0/local"
	"github.com/getnvoi/host0/cmd/h0/remote"
	"github.com/getnvoi/host0/internal/shared/publicdns"
)

func main() {
	// Every request h0 makes reaches a host the public resolvers know, whatever a cache in front of this machine holds.
	http.DefaultTransport.(*http.Transport).DialContext = publicdns.Dial
	root := &cobra.Command{Use: "h0", SilenceUsage: true, SilenceErrors: true}
	root.AddCommand(local.Cluster(), local.Machine())
	remote.Attach(root)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "h0:", err)
		os.Exit(1)
	}
}
