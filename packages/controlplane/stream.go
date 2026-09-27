package controlplane

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/getnvoi/host0/shared/contract"
)

// What happened, in order, for whoever is listening. A reader resumes after the last id it saw; one further
// behind than the ring, or with an id from another run, is told to reset.
type broker struct {
	mu sync.Mutex
	// Ids are <epoch>-<n>: n restarts at zero with the process, so the epoch tells a previous run's ids apart.
	epoch string
	next  int64
	ring  []entry
	subs  map[chan entry]struct{}
	// Events already announced per session, so only the new ones travel.
	sent map[string]int
}

type entry struct {
	id   int64
	data []byte
}

const ring = 2000

var bus = newBroker()

func newBroker() *broker {
	return &broker{epoch: strconv.FormatInt(time.Now().UnixNano(), 36), subs: map[chan entry]struct{}{}, sent: map[string]int{}}
}

func (b *broker) id(n int64) string { return b.epoch + "-" + strconv.FormatInt(n, 10) }

// The n of an id from this run; false for any other.
func (b *broker) parse(id string) (int64, bool) {
	epoch, n, ok := strings.Cut(id, "-")
	if !ok || epoch != b.epoch {
		return 0, false
	}
	v, err := strconv.ParseInt(n, 10, 64)
	return v, err == nil
}

func (b *broker) publish(u contract.Update) {
	data, _ := json.Marshal(u)
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

// Writes the session and announces what changed: its summary, and the events it gained since the last write.
func (p *Plane) save(s *contract.Session) error { return p.keep(s, true) }

// While a turn streams, its session is written at most this often; what it printed is sent to the UI at once.
const flush = 250 * time.Millisecond

// When each session was last written, and whether a write is due for one streaming.
var writes sync.Map

type write struct {
	at  time.Time
	due bool
}

// Saves and announces the session. Unless now, a write this soon after the last is left to a timer.
func (p *Plane) keep(s *contract.Session, now bool) error {
	s.Last = time.Now()
	// A list, never null: a session that has not printed anything yet has no events, not unknown ones.
	if s.Events == nil {
		s.Events = []contract.Event{}
	}
	w, _ := writes.Load(s.ID)
	last, _ := w.(write)
	if now || time.Since(last.at) >= flush {
		if err := p.Store.Put("sessions", s.ID, s); err != nil {
			return err
		}
		writes.Store(s.ID, write{at: time.Now()})
	} else if !last.due {
		writes.Store(s.ID, write{at: last.at, due: true})
		time.AfterFunc(flush, func() {
			unlock := lock(s.ID)
			defer unlock()
			if w, _ := writes.Load(s.ID); w.(write).due {
				p.Store.Put("sessions", s.ID, s)
				writes.Store(s.ID, write{at: time.Now()})
			}
		})
	}
	bus.mu.Lock()
	from := bus.sent[s.ID]
	if from > len(s.Events) {
		from = 0
	}
	bus.sent[s.ID] = len(s.Events)
	bus.mu.Unlock()
	sum := s.Summary()
	sum.Queued = p.queued(s.ID)
	bus.publish(contract.Update{Kind: "session", Session: &sum, From: from, Events: s.Events[from:]})
	return nil
}

// Announces the session's summary alone: its queue changed, not its record.
func (p *Plane) announce(s *contract.Session) {
	sum := s.Summary()
	sum.Queued = p.queued(s.ID)
	bus.mu.Lock()
	from := bus.sent[s.ID]
	bus.mu.Unlock()
	bus.publish(contract.Update{Kind: "session", Session: &sum, From: from})
}

func (p *Plane) saveApproval(a contract.Approval) error {
	if err := p.Store.Put("approvals", a.ID, a); err != nil {
		return err
	}
	bus.publish(contract.Update{Kind: "approval", Approval: &a})
	return nil
}

// Server-sent events. Every message carries its id; Last-Event-ID resumes after it.
func (p *Plane) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	c := make(chan entry, 256)
	bus.mu.Lock()
	var backlog []entry
	if header := r.Header.Get("Last-Event-ID"); header != "" {
		last, ok := bus.parse(header)
		// From another run of the plane, or older than the ring holds: the reader refetches.
		if !ok || last > bus.next || len(bus.ring) > 0 && bus.ring[0].id > last+1 {
			reset, _ := json.Marshal(contract.Update{Kind: "reset"})
			backlog = append(backlog, entry{bus.next, reset})
		} else {
			for _, e := range bus.ring {
				if e.id > last {
					backlog = append(backlog, e)
				}
			}
		}
	}
	bus.subs[c] = struct{}{}
	current := bus.next
	bus.mu.Unlock()
	defer func() {
		bus.mu.Lock()
		if _, ok := bus.subs[c]; ok {
			delete(bus.subs, c)
			close(c)
		}
		bus.mu.Unlock()
	}()

	write := func(e entry) error {
		_, err := fmt.Fprintf(w, "id: %s\ndata: %s\n\n", bus.id(e.id), e.data)
		flusher.Flush()
		return err
	}
	// A fresh reader learns where the stream stands, so its first reconnect has an id to resume from.
	fmt.Fprintf(w, "id: %s\nretry: 2000\n\n", bus.id(current))
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
