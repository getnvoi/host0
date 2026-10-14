// What every cloud.Cloud must do, checked against a cassette its client recorded from a real run.
package conformance

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
)

// One request and its answer. Headers are not kept, so no credential is.
type Interaction struct {
	Method   string `json:"method"`
	Path     string `json:"path"`
	Body     string `json:"body,omitempty"`
	Status   int    `json:"status"`
	Response string `json:"response"`
}

// Records through a real transport, or replays in order; a request that is not the next recorded one fails, named.
type Cassette struct {
	Record bool
	// Values replaced by "REDACTED" in what is recorded.
	Secrets []string
	// Called with each request served, in order.
	Served func(Interaction)

	mu   sync.Mutex
	tape []Interaction
	next int
	// The first request that was not recorded.
	Miss error
}

func Load(path string) (*Cassette, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	c := &Cassette{}
	if err := json.Unmarshal(raw, &c.tape); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return c, nil
}

func (c *Cassette) Save(path string) error {
	raw, err := json.MarshalIndent(c.tape, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}

func (c *Cassette) scrub(s string) string {
	for _, v := range c.Secrets {
		if v != "" {
			s = strings.ReplaceAll(s, v, "REDACTED")
		}
	}
	return s
}

func (c *Cassette) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		var err error
		if body, err = io.ReadAll(req.Body); err != nil {
			return nil, err
		}
		req.Body.Close()
	}
	got := Interaction{Method: req.Method, Path: req.URL.RequestURI(), Body: c.scrub(string(body))}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Record {
		req.Body = io.NopCloser(bytes.NewReader(body))
		res, err := http.DefaultTransport.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		raw, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil {
			return nil, err
		}
		got.Status, got.Response = res.StatusCode, c.scrub(string(raw))
		c.tape = append(c.tape, got)
	} else {
		if c.next >= len(c.tape) {
			return nil, c.miss(fmt.Errorf("unrecorded request %s %s: the cassette has ended", got.Method, got.Path))
		}
		want := c.tape[c.next]
		if want.Method != got.Method || want.Path != got.Path || want.Body != got.Body {
			return nil, c.miss(fmt.Errorf("unrecorded request %s %s %s; the cassette's next is %s %s %s",
				got.Method, got.Path, got.Body, want.Method, want.Path, want.Body))
		}
		c.next++
		got.Status, got.Response = want.Status, want.Response
	}
	if c.Served != nil {
		c.Served(got)
	}
	return &http.Response{StatusCode: got.Status, Status: http.StatusText(got.Status), Request: req,
		Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(got.Response))}, nil
}

func (c *Cassette) miss(err error) error {
	if c.Miss == nil {
		c.Miss = err
	}
	return err
}

// Recorded requests not replayed; none once a replay has run the whole scenario.
func (c *Cassette) Left() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Record {
		return 0
	}
	return len(c.tape) - c.next
}
