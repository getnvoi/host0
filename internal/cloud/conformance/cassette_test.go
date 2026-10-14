package conformance

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestUnrecordedRequestIsNamed(t *testing.T) {
	c := &Cassette{tape: []Interaction{{Method: "GET", Path: "/v1/servers", Query: "name=a", Status: 200, Response: `{"servers":[]}`}}}
	client := &http.Client{Transport: c}
	if _, err := client.Get("https://api.example/v1/servers?name=b"); err == nil || !strings.Contains(err.Error(), "unrecorded request GET /v1/servers?name=b") {
		t.Fatalf("got %v", err)
	}
	if res, err := client.Get("https://api.example/v1/servers?name=a"); err != nil || res.StatusCode != 200 || c.Left() != 0 {
		t.Fatalf("the recorded request: %v %v", res, err)
	}
	if _, err := client.Get("https://api.example/v1/servers?name=a"); err == nil || !strings.Contains(err.Error(), "ended") {
		t.Fatalf("past the end: %v", err)
	}
}

type answer string

func (a answer) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(a))), Request: r}, nil
}

func TestRecordScrubsPathsQueriesAndBodies(t *testing.T) {
	c := &Cassette{Record: true, Secrets: []string{"proj-1"}, Inner: answer(`{"project":"proj-1"}`)}
	client := &http.Client{Transport: c}
	if _, err := client.Post("https://api.example/v1/projects/proj-1/servers?project=proj-1", "application/json",
		strings.NewReader(`{"project":"proj-1"}`)); err != nil {
		t.Fatal(err)
	}
	got := c.tape[0]
	if strings.Contains(got.String()+got.Response, "proj-1") || got.Path != "/v1/projects/REDACTED/servers" || got.Query != "project=REDACTED" {
		t.Fatalf("recorded %s -> %s", got, got.Response)
	}
}
