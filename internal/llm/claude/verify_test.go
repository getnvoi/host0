package claude_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/llm/claude"
)

// The Messages API: the captured answer to a good credential, its authentication_error to "bad".
func anthropic(t *testing.T, seen *http.Request) *httptest.Server {
	ok, _ := os.ReadFile("../testdata/anthropic-200.json")
	refused, _ := os.ReadFile("../testdata/anthropic-401.json")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = *r.Clone(context.Background())
		body, _ := io.ReadAll(r.Body)
		seen.Header.Set("x-body", string(body))
		w.Header().Set("content-type", "application/json")
		if r.Header.Get("x-api-key") == "bad" || r.Header.Get("authorization") == "Bearer bad" {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write(refused)
			return
		}
		w.Write(ok)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestVerify(t *testing.T) {
	var seen http.Request
	srv := anthropic(t, &seen)
	r := claude.Runner{API: srv.URL}
	cases := []struct {
		values map[string]string
		header map[string]string
	}{
		{map[string]string{"kind": "api_key", "token": "sk-ant-api03"},
			map[string]string{"x-api-key": "sk-ant-api03", "authorization": "", "anthropic-beta": ""}},
		{map[string]string{"kind": "oauth", "token": "sk-ant-oat01"},
			map[string]string{"authorization": "Bearer sk-ant-oat01", "anthropic-beta": "oauth-2025-04-20", "x-api-key": ""}},
		{map[string]string{"kind": "bearer", "token": "zai", "base_url": srv.URL + "/api/anthropic/"},
			map[string]string{"authorization": "Bearer zai", "anthropic-beta": "", "x-api-key": ""}},
	}
	for _, c := range cases {
		if err := r.Verify(context.Background(), c.values); err != nil {
			t.Fatalf("%s: %v", c.values["kind"], err)
		}
		path := "/v1/messages"
		if c.values["base_url"] != "" {
			path = "/api/anthropic/v1/messages"
		}
		if seen.Method != "POST" || seen.URL.Path != path || seen.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("%s: %s %s %v", c.values["kind"], seen.Method, seen.URL.Path, seen.Header)
		}
		for k, v := range c.header {
			if seen.Header.Get(k) != v {
				t.Errorf("%s: %s is %q, want %q", c.values["kind"], k, seen.Header.Get(k), v)
			}
		}
		var body struct {
			Model     string `json:"model"`
			MaxTokens int    `json:"max_tokens"`
		}
		json.Unmarshal([]byte(seen.Header.Get("x-body")), &body)
		if body.Model != "claude-haiku-4-5" || body.MaxTokens != 1 {
			t.Errorf("%s: body %s", c.values["kind"], seen.Header.Get("x-body"))
		}
	}
	err := r.Verify(context.Background(), map[string]string{"kind": "api_key", "token": "bad"})
	want := srv.Listener.Addr().String() + " answered 401 Unauthorized: invalid x-api-key"
	if err == nil || err.Error() != want || errors.As(err, new(llm.Unreachable)) {
		t.Fatalf("refused: %v", err)
	}
}

func TestVerifyUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()
	err := claude.Runner{API: srv.URL}.Verify(context.Background(), map[string]string{"kind": "api_key", "token": "k"})
	if !errors.As(err, new(llm.Unreachable)) {
		t.Fatalf("a closed port is unreachable: %v", err)
	}
}
