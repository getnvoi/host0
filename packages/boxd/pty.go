package boxd

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

const (
	scrollback = 256 << 10
	ptyDir     = "/workspace/app"
	// The close code sent when the shell could not be started; a client should not attach again.
	failed websocket.StatusCode = 4000
)

// A shell on a pty that outlives its clients: output goes to every attached client and into the scrollback a
// client attaching later is sent first.
type term struct {
	id, command string
	started     time.Time
	cmd         *exec.Cmd
	f           *os.File
	mu          sync.Mutex
	ring        []byte
	clients     map[*client]struct{}
	dead        []byte // the exit message, once the shell has ended
}

type client struct {
	conn *websocket.Conn
	out  chan frame
}

type frame struct {
	typ  websocket.MessageType
	data []byte
}

type Terminal struct {
	ID      string `json:"id"`
	Command string `json:"command"`
	Started string `json:"started"`
	Clients int    `json:"clients"`
}

func (s *Server) terminals(w http.ResponseWriter, _ *http.Request) {
	out := []Terminal{}
	s.ptys.Range(func(_, v any) bool {
		t := v.(*term)
		t.mu.Lock()
		out = append(out, Terminal{t.id, t.command, t.started.Format(time.RFC3339), len(t.clients)})
		t.mu.Unlock()
		return true
	})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func (s *Server) open(id string, cols, rows int, dir string) (*term, error) {
	if v, ok := s.ptys.Load(id); ok {
		return v.(*term), nil
	}
	shell := "bash"
	if _, err := exec.LookPath(shell); err != nil {
		shell = "sh"
	}
	if dir == "" {
		dir = ptyDir
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		dir = "/"
	}
	cmd := exec.Command(shell, "-l")
	cmd.Dir = dir
	cmd.Env = append(environ(), "TERM=xterm-256color")
	f, err := pty.StartWithAttrs(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)},
		&syscall.SysProcAttr{Setsid: true, Setctty: true})
	if err != nil {
		return nil, err
	}
	t := &term{id: id, command: shell + " -l", started: time.Now(), cmd: cmd, f: f, clients: map[*client]struct{}{}}
	if v, loaded := s.ptys.LoadOrStore(id, t); loaded {
		syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		f.Close()
		cmd.Wait()
		return v.(*term), nil
	}
	pumped := make(chan struct{})
	go t.pump(pumped)
	go func() {
		code := exitCode(cmd.Wait())
		// Output still in the pty is read out before the exit is announced; a child holding the tty cannot hold this.
		select {
		case <-pumped:
		case <-time.After(time.Second):
		}
		f.Close()
		s.ptys.CompareAndDelete(id, t)
		t.exit(code)
	}()
	return t, nil
}

func (t *term) pump(done chan struct{}) {
	defer close(done)
	buf := make([]byte, 32<<10)
	for {
		n, err := t.f.Read(buf)
		if n > 0 {
			b := append([]byte(nil), buf[:n]...)
			t.mu.Lock()
			if t.ring = append(t.ring, b...); len(t.ring) > 2*scrollback {
				t.ring = append([]byte(nil), t.ring[len(t.ring)-scrollback:]...)
			}
			for c := range t.clients {
				t.send(c, frame{websocket.MessageBinary, b})
			}
			t.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// Queues f for c; a client that cannot keep up is detached. Called with t.mu held.
func (t *term) send(c *client, f frame) {
	select {
	case c.out <- f:
	default:
		t.drop(c)
	}
}

// Called with t.mu held.
func (t *term) drop(c *client) {
	if _, ok := t.clients[c]; ok {
		delete(t.clients, c)
		close(c.out)
	}
}

func (t *term) exit(code int) {
	msg, _ := json.Marshal(map[string]any{"type": "exit", "code": code})
	t.mu.Lock()
	defer t.mu.Unlock()
	t.dead = msg
	for c := range t.clients {
		t.send(c, frame{websocket.MessageText, msg})
		t.drop(c)
	}
}

func (s *Server) attach(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	cols, _ := strconv.Atoi(q.Get("cols"))
	rows, _ := strconv.Atoi(q.Get("rows"))
	if cols <= 0 || rows <= 0 {
		cols, rows = 120, 32
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)
	t, err := s.open(r.PathValue("id"), cols, rows, q.Get("dir"))
	if err != nil {
		conn.Close(failed, reason(err))
		return
	}
	c := &client{conn: conn, out: make(chan frame, 1024)}
	t.mu.Lock()
	// A terminal whose shell ended after it was looked up takes no clients: this one is told it has exited.
	if dead := t.dead; dead != nil {
		t.mu.Unlock()
		conn.Write(r.Context(), websocket.MessageText, dead)
		conn.Close(websocket.StatusNormalClosure, "")
		return
	}
	c.out <- frame{websocket.MessageBinary, append([]byte(nil), t.ring...)}
	t.clients[c] = struct{}{}
	t.mu.Unlock()
	ctx := r.Context()
	written := make(chan struct{})
	go func() {
		defer close(written)
		for f := range c.out {
			if conn.Write(ctx, f.typ, f.data) != nil {
				break
			}
		}
		conn.Close(websocket.StatusNormalClosure, "")
	}()
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			break
		}
		if typ == websocket.MessageBinary {
			t.f.Write(data)
			continue
		}
		var m struct {
			Type       string
			Cols, Rows int
		}
		if json.Unmarshal(data, &m) == nil && m.Type == "resize" && m.Cols > 0 && m.Rows > 0 {
			pty.Setsize(t.f, &pty.Winsize{Cols: uint16(m.Cols), Rows: uint16(m.Rows)})
		}
	}
	t.mu.Lock()
	t.drop(c)
	t.mu.Unlock()
	<-written
}

// A close reason fits in 123 bytes.
func reason(err error) string {
	msg := "terminal did not start: " + err.Error()
	if len(msg) > 123 {
		msg = strings.ToValidUTF8(msg[:123], "")
	}
	return msg
}

// Hangs up the terminal's process group, then kills what is left of it after 2s.
func (s *Server) kill(w http.ResponseWriter, r *http.Request) {
	v, ok := s.ptys.LoadAndDelete(r.PathValue("id"))
	if !ok {
		http.Error(w, "no such terminal", http.StatusNotFound)
		return
	}
	pid := v.(*term).cmd.Process.Pid
	syscall.Kill(-pid, syscall.SIGHUP)
	time.AfterFunc(2*time.Second, func() { syscall.Kill(-pid, syscall.SIGKILL) })
	w.WriteHeader(http.StatusNoContent)
}
