package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/getnvoi/nvoi/cli/internal/local"
	"github.com/getnvoi/nvoi/cli/internal/remote"
)

func main() {
	root := &cobra.Command{Use: "nvoi", SilenceUsage: true, SilenceErrors: true}
	root.AddCommand(local.Cluster())
	root.AddCommand(remote.Commands()...)
	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "nvoi:", err)
		os.Exit(1)
	}
}
