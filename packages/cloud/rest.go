package cloud

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// A JSON API: Base plus a path, authorized by Auth. Message reads the provider's own sentence from an error body.
type REST struct {
	Provider  string
	Base      string
	Auth      func(*http.Request)
	Transport http.RoundTripper
	Message   func(body []byte) string
}

// A response of 300 or more, with what the provider said about it.
type Error struct {
	Provider, Method, Path string
	Status                 int
	Message                string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s %s %s: %d %s", e.Provider, e.Method, e.Path, e.Status, e.Message)
}

func (r REST) Do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.Base+path, body)
	if err != nil {
		return err
	}
	r.Auth(req)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Transport: r.Transport, Timeout: time.Minute}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("%s %s %s: reading the response: %w", r.Provider, method, path, err)
	}
	if res.StatusCode >= 300 {
		msg := r.Message(raw)
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return &Error{Provider: r.Provider, Method: method, Path: path, Status: res.StatusCode, Message: msg}
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("%s %s %s: %w: %s", r.Provider, method, path, err, raw)
		}
	}
	return nil
}

// Calls f until it succeeds, fails with an error retry does not accept, or has run attempts times; the last error
// is the provider's own.
func Retry(ctx context.Context, attempts int, wait time.Duration, sleep Sleep, retry func(*Error) bool, f func() error) error {
	for i := 1; ; i++ {
		err := f()
		var e *Error
		if err == nil || !errors.As(err, &e) || !retry(e) || i == attempts {
			return err
		}
		if err := sleep(ctx, wait); err != nil {
			return err
		}
	}
}

// Waits d, or less when ctx ends. Conformance replaces it to replay a cassette at once.
type Sleep func(ctx context.Context, d time.Duration) error

func Wait(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

// A Kubernetes Secret manifest, its keys sorted.
func Secret(ns, name string, data map[string]string) string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	fmt.Fprintf(&b, "apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n  namespace: %s\ndata:\n", name, ns)
	for _, k := range keys {
		fmt.Fprintf(&b, "  %s: %s\n", k, base64.StdEncoding.EncodeToString([]byte(data[k])))
	}
	return b.String()
}
