// A client for boxd inside an actor, over whatever connection the sandbox hands out.
package box

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	Port        = 7777
	TokenHeader = "X-Box-Token"
	// The loopback port boxd relays a request to instead of serving it: every connection into an actor then
	// targets Port, and Substrate's router cannot hand one port's traffic to another.
	ProxyHeader = "X-Box-Proxy"
)

type Client struct {
	Token string // the sandbox's own
	// The token a fresh boxd starts with, its environment's; boxd is switched to Token with it on a 401.
	Seed string
	Dial func(ctx context.Context) (net.Conn, error)
}

type Run struct {
	Argv []string          `json:"argv"`
	Dir  string            `json:"dir,omitempty"`
	Env  map[string]string `json:"env,omitempty"`
}

func (c Client) http() *http.Client {
	return &http.Client{Transport: &http.Transport{
		DialContext:       func(ctx context.Context, _, _ string) (net.Conn, error) { return c.Dial(ctx) },
		DisableKeepAlives: true,
	}}
}

func (c Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	var b []byte
	if body != nil {
		var err error
		if b, err = io.ReadAll(body); err != nil {
			return nil, err
		}
	}
	res, err := c.send(ctx, method, path, b, c.Token)
	if e, ok := err.(*Error); ok && e.Status == http.StatusUnauthorized && c.Seed != "" && c.Seed != c.Token {
		if err := c.Rekey(ctx); err != nil {
			return nil, err
		}
		return c.send(ctx, method, path, b, c.Token)
	}
	return res, err
}

// Whether boxd takes the sandbox's own token, switching it first if it is still on its environment's.
func (c Client) Check(ctx context.Context) error {
	res, err := c.do(ctx, "GET", "/token", nil)
	if err != nil {
		return err
	}
	res.Body.Close()
	return nil
}

// Switches a boxd still on its environment's token to the sandbox's own.
func (c Client) Rekey(ctx context.Context) error {
	res, err := c.send(ctx, "PUT", "/token", []byte(c.Token), c.Seed)
	if err != nil {
		return err
	}
	res.Body.Close()
	return nil
}

func (c Client) send(ctx context.Context, method, path string, body []byte, token string) (*http.Response, error) {
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://box"+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set(TokenHeader, token)
	res, err := c.http().Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return nil, &Error{res.StatusCode, fmt.Sprintf("boxd %s %s: %d %s", method, path, res.StatusCode, strings.TrimSpace(string(b)))}
	}
	return res, nil
}

// A status boxd answered with, and what it said.
type Error struct {
	Status int
	Text   string
}

func (e *Error) Error() string { return e.Text }

// Waits until boxd answers.
func (c Client) Ready(ctx context.Context) error {
	var last error
	for deadline := time.Now().Add(5 * time.Minute); time.Now().Before(deadline); time.Sleep(2 * time.Second) {
		res, err := c.do(ctx, "GET", "/health", nil)
		if err == nil {
			res.Body.Close()
			return nil
		}
		last = err
	}
	return fmt.Errorf("boxd not answering: %w", last)
}

// Starts id (idempotent) and follows its output from offset; each line goes to line. Returns the exit code.
func (c Client) Exec(ctx context.Context, id string, r Run, offset int64, line func(string)) (int, error) {
	failures := 0
	// Whether to try again after err, waiting first. A status below 500 is boxd's answer and final.
	again := func(err error) bool {
		var e *Error
		if errors.As(err, &e) && e.Status < 500 {
			return false
		}
		if failures++; failures > 30 || ctx.Err() != nil {
			return false
		}
		return pause(ctx, 2*time.Second) == nil
	}
	// An empty Run follows a command already started: boxd has its log.
	if len(r.Argv) > 0 {
		b, _ := json.Marshal(r)
		for {
			res, err := c.do(ctx, "PUT", "/run/"+id, bytes.NewReader(b))
			if err == nil {
				res.Body.Close()
				break
			}
			if !again(err) {
				return -1, err
			}
		}
		failures = 0
	}
	var partial []byte
	for {
		chunk, exit, done, err := c.poll(ctx, id, offset)
		if err != nil {
			if !again(err) {
				return -1, err
			}
			continue
		}
		failures = 0
		offset += int64(len(chunk))
		partial = append(partial, chunk...)
		for {
			i := bytes.IndexByte(partial, '\n')
			if i < 0 {
				break
			}
			line(string(partial[:i]))
			partial = partial[i+1:]
		}
		if done {
			if len(partial) > 0 {
				line(string(partial))
			}
			code, err := strconv.Atoi(strings.TrimSpace(exit))
			if err != nil {
				return -1, fmt.Errorf("boxd run %s: bad exit code %q", id, exit)
			}
			return code, nil
		}
		// A poll that returned nothing ended on boxd's wait or on something in between; it is not repeated at once.
		if len(chunk) == 0 {
			if err := pause(ctx, time.Second); err != nil {
				return -1, err
			}
		}
	}
}

// One long poll of id's log from offset: the bytes, and the exit code when boxd sent one.
func (c Client) poll(ctx context.Context, id string, offset int64) ([]byte, string, bool, error) {
	// boxd answers within 30s; past this the connection is taken as dead.
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	res, err := c.do(ctx, "GET", fmt.Sprintf("/run/%s/log?offset=%d", id, offset), nil)
	if err != nil {
		return nil, "", false, err
	}
	defer res.Body.Close()
	chunk, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, "", false, err
	}
	exit, done := res.Header["X-Exit"]
	if !done {
		return chunk, "", false, nil
	}
	return chunk, exit[0], true, nil
}

func pause(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Exec that fails on a non-zero exit, with the output's tail in the error.
func (c Client) Must(ctx context.Context, id string, r Run, line func(string)) error {
	var tail []string
	code, err := c.Exec(ctx, id, r, 0, func(l string) {
		if line != nil {
			line(l)
		}
		if tail = append(tail, l); len(tail) > 20 {
			tail = tail[1:]
		}
	})
	if err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("%s exited %d: %s", id, code, strings.Join(tail, "\n"))
	}
	return nil
}

func (c Client) Cancel(ctx context.Context, id string) error {
	res, err := c.do(ctx, "DELETE", "/run/"+id, nil)
	if err == nil {
		res.Body.Close()
	}
	return err
}

func (c Client) Write(ctx context.Context, path string, mode int, data []byte) error {
	res, err := c.do(ctx, "PUT", fmt.Sprintf("/file?path=%s&mode=%o", path, mode), bytes.NewReader(data))
	if err == nil {
		res.Body.Close()
	}
	return err
}

// Runs r to its end and returns its combined output, capped by boxd, and its exit code. For short commands only.
func (c Client) Run(ctx context.Context, r Run) ([]byte, int, error) {
	b, _ := json.Marshal(r)
	res, err := c.do(ctx, "POST", "/exec", bytes.NewReader(b))
	if err != nil {
		return nil, -1, err
	}
	defer res.Body.Close()
	out, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, -1, err
	}
	code, err := strconv.Atoi(res.Header.Get("X-Exit"))
	if err != nil {
		return out, -1, fmt.Errorf("boxd exec: no exit code")
	}
	return out, code, nil
}

// Bytes of the file at path from offset, and the offset after them. ErrMissing when there is no such file.
func (c Client) Tail(ctx context.Context, path string, offset int64) ([]byte, int64, error) {
	res, err := c.do(ctx, "GET", fmt.Sprintf("/tail?path=%s&offset=%d", url.QueryEscape(path), offset), nil)
	if err != nil {
		if e := (*Error)(nil); errors.As(err, &e) && e.Status == http.StatusNotFound {
			return nil, offset, ErrMissing
		}
		return nil, offset, err
	}
	defer res.Body.Close()
	out, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, offset, err
	}
	next, err := strconv.ParseInt(res.Header.Get("X-Offset"), 10, 64)
	if err != nil {
		return nil, offset, fmt.Errorf("boxd tail: no offset")
	}
	return out, next, nil
}

var ErrMissing = errors.New("no such file")

type Terminal struct {
	ID      string `json:"id"`
	Command string `json:"command"`
	Started string `json:"started"`
	Clients int    `json:"clients"`
}

func (c Client) Terminals(ctx context.Context) ([]Terminal, error) {
	res, err := c.do(ctx, "GET", "/pty", nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out []Terminal
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("boxd terminals: %w", err)
	}
	return out, nil
}

func (c Client) Kill(ctx context.Context, id string) error {
	res, err := c.do(ctx, "DELETE", "/pty/"+id, nil)
	if err == nil {
		res.Body.Close()
	}
	return err
}
