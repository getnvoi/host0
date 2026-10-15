package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/shared/naming"
)

// Rung on every line a run writes; a stream waits on it.
type bell struct {
	mu sync.Mutex
	ch chan struct{}
}

func (b *bell) wait() <-chan struct{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ch == nil {
		b.ch = make(chan struct{})
	}
	return b.ch
}

func (b *bell) ring() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ch != nil {
		close(b.ch)
		b.ch = nil
	}
}

// Starts kind (install or destroy) on w; one run at a time per workspace.
func (h *hub) start(w Workspace, kind string) (Run, error) {
	r := Run{WorkspaceID: w.ID, Kind: kind, State: "running"}
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		var open int64
		if err := tx.Model(&Run{}).Where("workspace_id = ? AND state = ?", w.ID, "running").Count(&open).Error; err != nil {
			return err
		}
		if open > 0 {
			return said(http.StatusConflict, "workspace %s has a run open already", w.Name)
		}
		return tx.Create(&r).Error
	})
	if err != nil {
		return r, err
	}
	go h.execute(r, w)
	return r, nil
}

func (h *hub) execute(r Run, w Workspace) {
	out := &lines{h: h, run: r.ID, prefix: w.Name + " #" + strconv.Itoa(int(r.ID)) + ": "}
	l := &laptop{db: h.DB, ws: w.ID, name: w.Name}
	var err error
	if r.Kind == "destroy" {
		err = h.Destroy(context.Background(), w, out)
	} else {
		err = h.Install(context.Background(), w, l, out)
	}
	if err == nil {
		err = out.err
	}
	last, state := "", "ok"
	switch {
	case err != nil:
		last, state = err.Error(), "failed"
	case r.Kind == "destroy":
		last = "workspace " + w.Name + " is destroyed"
	default:
		last = "workspace " + w.Name + " is ready at https://" + naming.Host(naming.Cluster{Name: w.Name}, "app", h.Zone)
	}
	if err := h.end(r, w, out.flush(), last, state); err != nil {
		log.Printf("%s%v", out.prefix, err)
	}
}

// Writes the run's last line and its state together; a destroy that ended ok removes the workspace.
func (h *hub) end(r Run, w Workspace, n int, last, state string) error {
	defer h.bell.ring()
	log.Printf("%s#%d %s: %s", w.Name, r.ID, state, last)
	return h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&Line{RunID: r.ID, N: n, Text: last, State: state}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Run{}).Where("id = ?", r.ID).Update("state", state).Error; err != nil {
			return err
		}
		if r.Kind == "destroy" && state == "ok" {
			// The plane is gone with its token; the sealing key stays, as ~/.h0/key does.
			if err := tx.Model(&Workspace{ID: w.ID}).Select("Token").Updates(&Workspace{}).Error; err != nil {
				return err
			}
			return tx.Delete(&Workspace{}, w.ID).Error
		}
		return nil
	})
}

// A run left open by a hub that stopped is failed, said on its last line.
func (h *hub) abandon() error {
	var open []Run
	if err := h.DB.Where("state = ?", "running").Find(&open).Error; err != nil {
		return err
	}
	for _, r := range open {
		var w Workspace
		if err := h.DB.Unscoped().First(&w, r.WorkspaceID).Error; err != nil {
			return err
		}
		var n int64
		if err := h.DB.Model(&Line{}).Where("run_id = ?", r.ID).Count(&n).Error; err != nil {
			return err
		}
		if err := h.end(r, w, int(n), "the hub stopped while this run was open: start it again", "failed"); err != nil {
			return err
		}
	}
	return nil
}

// The run's output, a row per line as it is written, and the hub's log beside it.
type lines struct {
	h      *hub
	run    uint
	prefix string
	mu     sync.Mutex
	buf    []byte
	n      int
	err    error
}

func (l *lines) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.buf = append(l.buf, p...)
	for {
		i := bytes.IndexByte(l.buf, '\n')
		if i < 0 {
			return len(p), l.err
		}
		l.add(string(bytes.TrimRight(l.buf[:i], "\r")))
		l.buf = l.buf[i+1:]
	}
}

func (l *lines) add(text string) {
	if l.err != nil {
		return
	}
	log.Print(l.prefix + text)
	if err := l.h.DB.Create(&Line{RunID: l.run, N: l.n, Text: text}).Error; err != nil {
		l.err = fmt.Errorf("writing line %d of the run: %w", l.n, err)
		return
	}
	l.n++
	l.h.bell.ring()
}

// Writes what is left without a newline; the next line's N.
func (l *lines) flush() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buf) > 0 {
		l.add(string(l.buf))
		l.buf = nil
	}
	return l.n
}

// GET /v1/workspaces/{ws}/runs/{run}/stream?from=<n>: each line from n as an SSE message, until the last.
func (h *hub) stream(w http.ResponseWriter, r *http.Request) {
	ws, err := h.workspaceOf(r)
	if err != nil {
		write(w, err)
		return
	}
	var run Run
	if err := h.DB.Where("id = ? AND workspace_id = ?", r.PathValue("run"), ws.ID).First(&run).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		write(w, said(http.StatusNotFound, "workspace %s has no run %s", ws.Name, r.PathValue("run")))
		return
	} else if err != nil {
		write(w, err)
		return
	}
	from := 0
	if s := r.URL.Query().Get("from"); s != "" {
		if from, err = strconv.Atoi(s); err != nil || from < 0 {
			write(w, said(http.StatusBadRequest, "from %q: a line index, 0 or more", s))
			return
		}
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flush := func() {
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	flush()
	for {
		rung := h.bell.wait()
		var ls []Line
		if err := h.DB.Where("run_id = ? AND n >= ?", run.ID, from).Order("n").Find(&ls).Error; err != nil {
			fmt.Fprintf(w, "event: error\ndata: %s\n\n", jsonString(err.Error()))
			flush()
			return
		}
		for _, l := range ls {
			msg := map[string]string{"line": l.Text}
			if l.State != "" {
				msg["state"] = l.State
			}
			b, _ := json.Marshal(msg)
			fmt.Fprintf(w, "id: %d\ndata: %s\n\n", l.N, b)
			from = l.N + 1
			if l.State != "" {
				flush()
				return
			}
		}
		flush()
		select {
		case <-r.Context().Done():
			return
		case <-rung:
		case <-time.After(15 * time.Second):
			// A comment that says where the run is, so a proxy between keeps the stream.
			fmt.Fprintf(w, ": %d lines, run %s\n\n", from, run.Kind)
			flush()
		}
	}
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// The install's files of one workspace, as the hub holds them: its plane's sealing key and API token, sealed.
type laptop struct {
	db   *gorm.DB
	ws   uint
	name string
}

func (l *laptop) Key() ([]byte, error) {
	var w Workspace
	if err := l.db.Unscoped().First(&w, l.ws).Error; err != nil {
		return nil, err
	}
	if w.Seal == "" {
		return nil, nil
	}
	return []byte(w.Seal), nil
}

func (l *laptop) SaveKey(k []byte) error {
	return l.db.Unscoped().Model(&Workspace{ID: l.ws}).Select("Seal").Updates(&Workspace{Seal: string(k)}).Error
}

func (l *laptop) KeyPath() string { return "the hub's record of workspace " + l.name }

func (l *laptop) Certs(string) (map[string][]byte, error) { return nil, nil }

func (l *laptop) SaveCerts(string, []byte, map[string][]byte) error {
	return errors.New("the hub keeps no certificate: its workspaces are behind the tunnel")
}

func (l *laptop) CertsPath(string) string { return "" }

func (l *laptop) SavePlane(_, token string) error {
	return l.db.Unscoped().Model(&Workspace{ID: l.ws}).Select("Token").Updates(&Workspace{Token: token}).Error
}

var _ io.Writer = (*lines)(nil)
