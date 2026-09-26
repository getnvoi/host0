// boxd serve (default), boxd mcp, boxd install <path>.
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/getnvoi/nvoi/boxd"
)

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "mcp":
		if err := boxd.MCP(json.RawMessage(os.Getenv("NVOI_TOOLS")), os.Stdin, os.Stdout); err != nil {
			log.Fatal(err)
		}
	case "install":
		// Copies this binary onto the shared volume, for a container whose image does not carry it, then stays up.
		if err := install(os.Args[2]); err != nil {
			log.Fatal(err)
		}
		// Every container of an actor must be alive when it is snapshotted; a bare select{} is a deadlock to the runtime.
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
	default:
		s := &boxd.Server{Token: os.Getenv("NVOI_BOX_TOKEN"), Root: "/workspace/.nvoi/runs"}
		if s.Token == "" {
			log.Fatal("NVOI_BOX_TOKEN is required")
		}
		if err := os.MkdirAll(s.Root, 0o755); err != nil {
			log.Fatal(err)
		}
		if err := s.Recover(); err != nil {
			log.Fatal(err)
		}
		log.Fatal(http.ListenAndServe(":7777", s.Handler()))
	}
}

func install(dst string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	in, err := os.Open(self)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}
