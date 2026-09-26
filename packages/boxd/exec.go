package boxd

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

const (
	execLimit = 8 << 20
	tailLimit = 1 << 20
)

// Runs a short command to its end and answers with its combined output; X-Exit carries the code. Past 60s or
// execLimit bytes of output its process group is killed.
func (s *Server) exec(w http.ResponseWriter, r *http.Request) {
	var run Run
	if err := json.NewDecoder(r.Body).Decode(&run); err != nil || len(run.Argv) == 0 {
		http.Error(w, "argv required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	cmd := command(run)
	out := &capped{limit: execLimit, full: cancel}
	cmd.Stdout, cmd.Stderr = out, out
	cmd.WaitDelay = 2 * time.Second
	code := 0
	if err := cmd.Start(); err != nil {
		code = 127
		out.Write([]byte(err.Error() + "\n"))
	} else {
		stop := context.AfterFunc(ctx, func() { syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) })
		err := cmd.Wait()
		stop()
		// WaitDelay ran out on output held open by a leftover child; the command itself succeeded.
		if errors.Is(err, exec.ErrWaitDelay) && cmd.ProcessState != nil && cmd.ProcessState.ExitCode() == 0 {
			err = nil
		}
		code = exitCode(err)
	}
	w.Header().Set("X-Exit", strconv.Itoa(code))
	w.Write(out.b)
}

// Keeps the first limit bytes; the byte past it calls full.
type capped struct {
	mu    sync.Mutex
	b     []byte
	limit int
	full  func()
}

func (c *capped) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if room := c.limit - len(c.b); len(p) > room {
		c.b = append(c.b, p[:max(room, 0)]...)
		c.full()
		return len(p), nil
	}
	c.b = append(c.b, p...)
	return len(p), nil
}

// Up to tailLimit bytes of a file from offset, without waiting; X-Offset is where the next read starts.
func (s *Server) tail(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if !filepath.IsAbs(path) {
		http.Error(w, "absolute path required", http.StatusBadRequest)
		return
	}
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(io.NewSectionReader(f, offset, 1<<62), tailLimit))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("X-Offset", strconv.FormatInt(offset+int64(len(b)), 10))
	w.Write(b)
}

// A process killed by a signal exits 128+signal, as a shell reports it.
func exitCode(err error) int {
	e, ok := err.(*exec.ExitError)
	switch {
	case err == nil:
		return 0
	case !ok:
		return 255
	}
	if ws, ok := e.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	return e.ExitCode()
}
