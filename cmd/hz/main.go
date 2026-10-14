package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/hz/local"
	"github.com/getnvoi/host0/cmd/hz/remote"
)

func main() {
	root := &cobra.Command{Use: "hz", SilenceUsage: true, SilenceErrors: true}
	root.AddCommand(local.Cluster(), local.Machine())
	remote.Attach(root)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "hz:", err)
		os.Exit(1)
	}
}
