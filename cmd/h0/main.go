package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/h0/local"
	"github.com/getnvoi/host0/cmd/h0/remote"
)

func main() {
	root := &cobra.Command{Use: "h0", SilenceUsage: true, SilenceErrors: true}
	root.AddCommand(local.Cluster(), local.Machine())
	remote.Attach(root)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "h0:", err)
		os.Exit(1)
	}
}
