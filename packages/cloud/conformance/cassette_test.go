package conformance

import (
	"net/http"
	"strings"
	"testing"
)

func TestUnrecordedRequestIsNamed(t *testing.T) {
	c := &Cassette{tape: []Interaction{{Method: "GET", Path: "/v1/servers?name=a", Status: 200, Response: `{"servers":[]}`}}}
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

func TestScrub(t *testing.T) {
	c := &Cassette{Secrets: []string{"s3cret"}}
	if got := c.scrub(`{"token":"s3cret"}`); got != `{"token":"REDACTED"}` {
		t.Fatal(got)
	}
}
