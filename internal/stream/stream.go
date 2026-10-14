// What happened, in order, for whoever is listening: one server-sent event per value published.
package stream

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A reader resumes after the last id it saw; one further behind than the ring, or with an id from another run, is
// sent the reset value and refetches.
type Broker struct {
	mu sync.Mutex
	// Ids are <epoch>-<n>: n restarts at zero with the process, so the epoch tells a previous run's ids apart.
	epoch string
	next  int64
	ring  []entry
	subs  map[chan entry]struct{}
	reset []byte
}

type entry struct {
	id   int64
	data []byte
}

const ring = 2000

func New(reset any) *Broker {
	data, _ := json.Marshal(reset)
	return &Broker{epoch: strconv.FormatInt(time.Now().UnixNano(), 36), subs: map[chan entry]struct{}{}, reset: data}
}

func (b *Broker) id(n int64) string { return b.epoch + "-" + strconv.FormatInt(n, 10) }

// The n of an id from this run; false for any other.
func (b *Broker) parse(id string) (int64, bool) {
	epoch, n, ok := strings.Cut(id, "-")
	if !ok || epoch != b.epoch {
		return 0, false
	}
	v, err := strconv.ParseInt(n, 10, 64)
	return v, err == nil
}

func (b *Broker) Publish(v any) {
	data, _ := json.Marshal(v)
	b.mu.Lock()
	defer b.mu.Unlock()
	b.next++
	e := entry{b.next, data}
	b.ring = append(b.ring, e)
	if len(b.ring) > ring {
		b.ring = b.ring[len(b.ring)-ring:]
	}
	for c := range b.subs {
		select {
		case c <- e:
		default:
			// A reader too slow to keep up is dropped; it reconnects and resumes from its last id.
			close(c)
			delete(b.subs, c)
		}
	}
}

// Server-sent events. Every message carries its id; Last-Event-ID resumes after it.
func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	c := make(chan entry, 256)
	b.mu.Lock()
	var backlog []entry
	if header := r.Header.Get("Last-Event-ID"); header != "" {
		last, ok := b.parse(header)
		// From another run of the plane, or older than the ring holds: the reader refetches.
		if !ok || last > b.next || len(b.ring) > 0 && b.ring[0].id > last+1 {
			backlog = append(backlog, entry{b.next, b.reset})
		} else {
			for _, e := range b.ring {
				if e.id > last {
					backlog = append(backlog, e)
				}
			}
		}
	}
	b.subs[c] = struct{}{}
	current := b.next
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		if _, ok := b.subs[c]; ok {
			delete(b.subs, c)
			close(c)
		}
		b.mu.Unlock()
	}()

	write := func(e entry) error {
		_, err := fmt.Fprintf(w, "id: %s\ndata: %s\n\n", b.id(e.id), e.data)
		flusher.Flush()
		return err
	}
	// A fresh reader learns where the stream stands, so its first reconnect has an id to resume from.
	fmt.Fprintf(w, "id: %s\nretry: 2000\n\n", b.id(current))
	flusher.Flush()
	for _, e := range backlog {
		if write(e) != nil {
			return
		}
	}
	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-c:
			if !ok || write(e) != nil {
				return
			}
		case <-keepalive.C:
			// Through Cloudflare, an idle stream is cut at 100 seconds.
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
