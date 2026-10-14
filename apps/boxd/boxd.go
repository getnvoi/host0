// boxd runs inside an actor: it starts commands detached, keeps their output on the durable dir, and hands it
// back from any offset. A dropped connection or a suspend loses nothing; the caller asks again from where it was.
package boxd

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const TokenHeader = "X-Box-Token"

const (
	// A run that no process of this boxd is waiting on and that has no exit file was lost to a restart.
	lost = 137
	// The most one log response carries.
	logLimit = 1 << 20
)

// How long cancel waits after SIGTERM before it sends SIGKILL.
var grace = 5 * time.Second

type Run struct {
	Argv []string          `json:"argv"`
	Dir  string            `json:"dir"`
	Env  map[string]string `json:"env"`
	User string            `json:"user"`
}

type Server struct {
	// The token boxd starts with: its environment's. The plane replaces it with one of the sandbox's own (PUT /token).
	Token string
	key   atomic.Pointer[string]
	Root  string // one directory per command: log, exit, pid
	ptys  sync.Map
	live  sync.Map // ids of runs this process started and has not yet seen end
}

var id = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("PUT /run/{id}", checked(s.start))
	mux.HandleFunc("GET /run/{id}/log", checked(s.log))
	mux.HandleFunc("DELETE /run/{id}", checked(s.cancel))
	mux.HandleFunc("PUT /file", s.file)
	mux.HandleFunc("POST /exec", s.exec)
	mux.HandleFunc("GET /tail", s.tail)
	mux.HandleFunc("GET /pty", s.terminals)
	mux.HandleFunc("PUT /token", s.rekey)
	// Whether the request's token opens this boxd: checked above like every other.
	mux.HandleFunc("GET /token", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /pty/{id}", checked(s.attach))
	mux.HandleFunc("DELETE /pty/{id}", checked(s.kill))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h, relayed := proxied(r)
		if (relayed || r.URL.Path != "/health") && subtle.ConstantTimeCompare([]byte(r.Header.Get(TokenHeader)), []byte(s.token())) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if relayed {
			h.ServeHTTP(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func checked(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !id.MatchString(r.PathValue("id")) {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		h(w, r)
	}
}

func (s *Server) dir(r *http.Request) string { return filepath.Join(s.Root, r.PathValue("id")) }

// Idempotent: a command already started under this id is left running.
func (s *Server) start(w http.ResponseWriter, r *http.Request) {
	var run Run
	if err := json.NewDecoder(r.Body).Decode(&run); err != nil || len(run.Argv) == 0 {
		http.Error(w, "argv required", http.StatusBadRequest)
		return
	}
	id, d := r.PathValue("id"), s.dir(r)
	// Marked live before the log exists, so log never sees a starting run as lost.
	if _, busy := s.live.LoadOrStore(id, struct{}{}); busy {
		w.WriteHeader(http.StatusOK)
		return
	}
	if _, err := os.Stat(filepath.Join(d, "log")); err == nil {
		s.live.Delete(id)
		w.WriteHeader(http.StatusOK)
		return
	}
	if err := os.MkdirAll(d, 0o755); err != nil {
		s.live.Delete(id)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out, err := os.Create(filepath.Join(d, "log"))
	if err != nil {
		s.live.Delete(id)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	cmd := command(run)
	cmd.Stdout, cmd.Stderr = out, out
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(out, "%v\n", err)
		out.Close()
		err = writeExit(d, 127)
		s.live.Delete(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		return
	}
	os.WriteFile(filepath.Join(d, "pid"), []byte(strconv.Itoa(cmd.Process.Pid)), 0o644)
	go func() {
		code := exitCode(cmd.Wait())
		out.Close()
		if err := writeExit(d, code); err != nil {
			log.Printf("run %s: %v", id, err)
		}
		s.live.Delete(id)
	}()
	w.WriteHeader(http.StatusCreated)
}

// Writes the exit file whole or not at all.
func writeExit(d string, code int) error {
	tmp := filepath.Join(d, "exit.tmp")
	if err := os.WriteFile(tmp, []byte(strconv.Itoa(code)), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(d, "exit"))
}

// The run's exit code, and whether it has ended. Live is read before the exit file: a run writes its exit file
// before it leaves live, so a run seen neither live nor exited was lost.
func (s *Server) status(id string) (string, bool) {
	_, live := s.live.Load(id)
	b, err := os.ReadFile(filepath.Join(s.Root, id, "exit"))
	if code := strings.TrimSpace(string(b)); err == nil && code != "" {
		return code, true
	}
	if live {
		return "", false
	}
	return strconv.Itoa(lost), true
}

// Ends every run a previous boxd left without an exit file: its process is gone with that boxd. Called once
// before serving.
func (s *Server) Recover() error {
	entries, err := os.ReadDir(s.Root)
	if err != nil {
		return err
	}
	for _, e := range entries {
		d := filepath.Join(s.Root, e.Name())
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(d, "log")); err != nil {
			continue
		}
		if b, err := os.ReadFile(filepath.Join(d, "exit")); err == nil && strings.TrimSpace(string(b)) != "" {
			continue
		}
		f, err := os.OpenFile(filepath.Join(d, "log"), os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		_, err = io.WriteString(f, "lost: boxd restarted\n")
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
		// Its process group may have outlived the boxd that started it: it would run on beside the next turn.
		if b, err := os.ReadFile(filepath.Join(d, "pid")); err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && pid > 1 {
				syscall.Kill(-pid, syscall.SIGKILL)
			}
		}
		if err := writeExit(d, lost); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) token() string {
	if k := s.key.Load(); k != nil {
		return *k
	}
	return s.Token
}

// Replaces the token; the request carries the current one, checked above.
func (s *Server) rekey(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(io.LimitReader(r.Body, 256))
	next := strings.TrimSpace(string(b))
	if err != nil || len(next) < 32 {
		http.Error(w, "a token of 32 characters or more is required", http.StatusBadRequest)
		return
	}
	s.key.Store(&next)
	w.WriteHeader(http.StatusNoContent)
}

// The command for run, in its own process group.
func command(run Run) *exec.Cmd {
	cmd := exec.Command(run.Argv[0], run.Argv[1:]...)
	if run.User != "" {
		cmd = exec.Command("runuser", append([]string{"-u", run.User, "--"}, run.Argv...)...)
	}
	cmd.Dir = run.Dir
	cmd.Env = environ()
	for k, v := range run.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd
}

// boxd's environment without its own token, for the processes it starts.
func environ() []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "HZ_BOX_TOKEN=") {
			env = append(env, kv)
		}
	}
	return env
}

// Up to logLimit bytes from offset on. Waits up to 30s for new output; X-Exit is set once the command has ended and
// this response returns every byte left.
func (s *Server) log(w http.ResponseWriter, r *http.Request) {
	id, d := r.PathValue("id"), s.dir(r)
	var offset int64
	if v := r.URL.Query().Get("offset"); v != "" {
		var err error
		if offset, err = strconv.ParseInt(v, 10, 64); err != nil || offset < 0 {
			http.Error(w, "bad offset", http.StatusBadRequest)
			return
		}
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		// Status is read before the size: a run closes its log before it writes its exit file.
		code, done := s.status(id)
		f, err := os.Open(filepath.Join(d, "log"))
		if err != nil {
			http.Error(w, "no such run", http.StatusNotFound)
			return
		}
		info, err := f.Stat()
		if err != nil {
			f.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		left := max(info.Size()-offset, 0)
		if left > 0 || done || time.Now().After(deadline) || r.Context().Err() != nil {
			n := min(left, logLimit)
			if done && left <= logLimit {
				w.Header().Set("X-Exit", code)
			}
			w.Header().Set("Content-Length", strconv.FormatInt(n, 10))
			io.Copy(w, io.NewSectionReader(f, offset, n))
			f.Close()
			return
		}
		f.Close()
		time.Sleep(200 * time.Millisecond)
	}
}

// SIGTERM to the run's process group, then SIGKILL after grace if any of it is left. 409 once the run has ended.
func (s *Server) cancel(w http.ResponseWriter, r *http.Request) {
	raw, err := os.ReadFile(filepath.Join(s.dir(r), "pid"))
	if err != nil {
		http.Error(w, "no such run", http.StatusNotFound)
		return
	}
	if _, done := s.status(r.PathValue("id")); done {
		http.Error(w, "run has ended", http.StatusConflict)
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		http.Error(w, "bad pid", http.StatusInternalServerError)
		return
	}
	syscall.Kill(-pid, syscall.SIGTERM)
	time.AfterFunc(grace, func() {
		if syscall.Kill(-pid, 0) == nil {
			syscall.Kill(-pid, syscall.SIGKILL)
		}
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if !filepath.IsAbs(path) {
		http.Error(w, "absolute path required", http.StatusBadRequest)
		return
	}
	mode, _ := strconv.ParseUint(r.URL.Query().Get("mode"), 8, 32)
	if mode == 0 {
		mode = 0o644
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(mode))
	if err == nil {
		_, err = io.Copy(f, r.Body)
		f.Close()
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
