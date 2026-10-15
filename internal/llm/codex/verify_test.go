package codex_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"testing"

	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/llm/codex"
)

func TestVerify(t *testing.T) {
	ok, _ := os.ReadFile("../testdata/openai-200.json")
	refused, _ := os.ReadFile("../testdata/openai-401.json")
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.Method+" "+r.URL.Path+" "+r.Header.Get("authorization"))
		w.Header().Set("content-type", "application/json")
		if r.Header.Get("authorization") == "Bearer sk-bad" {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write(refused)
			return
		}
		w.Write(ok)
	}))
	defer srv.Close()
	r := codex.Runner{API: srv.URL + "/v1"}
	if err := r.Verify(context.Background(), map[string]string{"token": "sk-proj"}); err != nil {
		t.Fatal(err)
	}
	if err := r.Verify(context.Background(), map[string]string{"token": "k", "base_url": srv.URL + "/compat/"}); err != nil {
		t.Fatal(err)
	}
	err := r.Verify(context.Background(), map[string]string{"token": "sk-bad"})
	want := srv.Listener.Addr().String() + " answered 401 Unauthorized: Incorrect API key provided: sk-bad. " +
		"You can find your API key at https://platform.openai.com/account/api-keys."
	if err == nil || err.Error() != want {
		t.Fatalf("refused: %v", err)
	}
	if want := []string{"GET /v1/models Bearer sk-proj", "GET /compat/models Bearer k", "GET /v1/models Bearer sk-bad"}; !slices.Equal(asked, want) {
		t.Fatalf("asked %v, want %v", asked, want)
	}
	srv.Close()
	if err := r.Verify(context.Background(), map[string]string{"token": "sk-proj"}); !errors.As(err, new(llm.Unreachable)) {
		t.Fatalf("a closed port is unreachable: %v", err)
	}
}

// A ChatGPT sign-in is read, never sent: these run with nothing listening.
func TestVerifySignIn(t *testing.T) {
	r := codex.Runner{API: "http://127.0.0.1:1"}
	signedIn := `{"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{"id_token":"h.p.s","access_token":"a",` +
		`"refresh_token":"r","account_id":"x"},"last_refresh":"2026-10-04T05:34:17Z"}`
	for token, want := range map[string]string{
		signedIn:                       "",
		`{"OPENAI_API_KEY":"sk-proj"}`: "",
		`{"OPENAI_API_KEY":null}`:      "auth.json has neither OPENAI_API_KEY nor tokens: run codex login",
		`{"tokens":{"id_token":"h.p.s","access_token":"a"}}`:                 "auth.json tokens lack id_token, access_token or refresh_token: run codex login",
		`{"tokens":{"id_token":"x","access_token":"a","refresh_token":"r"}}`: "auth.json id_token is not a JWT: run codex login",
	} {
		got := ""
		if err := r.Verify(context.Background(), map[string]string{"token": token}); err != nil {
			got = err.Error()
		}
		if got != want {
			t.Errorf("%s: %q, want %q", token, got, want)
		}
	}
}
