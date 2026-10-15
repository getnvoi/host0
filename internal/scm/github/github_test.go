package github

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
		if r.URL.Query().Get("head") != "o:h0/x" {
			t.Errorf("head %q", r.URL.Query().Get("head"))
		}
		w.Write([]byte(`[{"html_url":"https://github.com/o/r/pull/1"}]`))
	}))
	defer srv.Close()
	root = srv.URL
	url, err := Forge{}.PullRequest(context.Background(), "t", "o/r", "h0/x", "main", "T", "B")
	if err != nil || url != "https://github.com/o/r/pull/1" || posts != 0 {
		t.Fatalf("url %q, err %v, posts %d", url, err, posts)
	}
}

// The answers are GitHub's documented examples for these two operations, as GitHub returns them.
func TestRepositories(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ghu_user" {
			t.Errorf("authorization %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/user/installations":
			http.ServeFile(w, r, "testdata/installations.json")
		case "/user/installations/1/repositories":
			http.ServeFile(w, r, "testdata/installation-repositories.json")
		default:
			w.WriteHeader(404)
			w.Write([]byte(`{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}`))
		}
	}))
	defer srv.Close()
	root = srv.URL
	rs, err := Forge{}.Repositories(context.Background(), "ghu_user")
	if err != nil {
		t.Fatal(err)
	}
	if len(rs) != 1 || rs[0].FullName != "octocat/Hello-World" || rs[0].DefaultBranch != "master" || rs[0].Private {
		t.Fatalf("repositories %+v", rs)
	}
}

// A token GitHub refuses is reported with GitHub's own message.
func TestRepositoriesRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest","status":"401"}`))
	}))
	defer srv.Close()
	root = srv.URL
	_, err := Forge{}.Repositories(context.Background(), "gone")
	if err == nil || err.Error() != "github 401 on /user/installations?per_page=100&page=1: Bad credentials" {
		t.Fatalf("err %v", err)
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
	url, err := Forge{}.PullRequest(context.Background(), "t", "o/r", "h0/x", "main", "T", "B")
	if err != nil || url != "https://github.com/o/r/pull/2" {
		t.Fatalf("url %q, err %v", url, err)
	}
}
