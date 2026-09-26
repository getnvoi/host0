package forge

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPullRequestReturnsOpen(t *testing.T) {
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			w.Write([]byte(`{"html_url":"https://github.com/o/r/pull/2"}`))
			return
		}
		if r.URL.Query().Get("head") != "o:nvoi/x" {
			t.Errorf("head %q", r.URL.Query().Get("head"))
		}
		w.Write([]byte(`[{"html_url":"https://github.com/o/r/pull/1"}]`))
	}))
	defer srv.Close()
	root = srv.URL
	url, err := GitHub{}.PullRequest(context.Background(), "t", "o/r", "nvoi/x", "main", "T", "B")
	if err != nil || url != "https://github.com/o/r/pull/1" || posts != 0 {
		t.Fatalf("url %q, err %v, posts %d", url, err, posts)
	}
}

func TestPullRequestOpens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.Write([]byte(`[]`))
			return
		}
		if r.URL.Path != "/repos/o/r/pulls" {
			t.Errorf("path %s", r.URL.Path)
		}
		w.Write([]byte(`{"html_url":"https://github.com/o/r/pull/2"}`))
	}))
	defer srv.Close()
	root = srv.URL
	url, err := GitHub{}.PullRequest(context.Background(), "t", "o/r", "nvoi/x", "main", "T", "B")
	if err != nil || url != "https://github.com/o/r/pull/2" {
		t.Fatalf("url %q, err %v", url, err)
	}
}
