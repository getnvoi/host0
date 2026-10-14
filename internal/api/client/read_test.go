package client

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A refusal is the sentence the plane wrote, as a problem's detail or as text.
func TestRefusal(t *testing.T) {
	for _, c := range []struct{ contentType, body, want string }{
		{"application/problem+json", `{"title":"Conflict","status":409,"detail":"approval a1 is done"}`, "approval a1 is done"},
		{"text/plain; charset=utf-8", "approval a1 is done\n", "approval a1 is done"},
		{"text/plain; charset=utf-8", "", "409 Conflict"},
	} {
		res := &http.Response{StatusCode: 409, Status: "409 Conflict", Header: http.Header{"Content-Type": {c.contentType}},
			Body: io.NopCloser(strings.NewReader(c.body)), Request: httptest.NewRequest("POST", "/approvals/a1/deny", nil)}
		err := Done(res, nil)
		r, ok := err.(*Refused)
		if !ok || r.Status != 409 || r.Detail != c.want {
			t.Errorf("%s %q: %#v", c.contentType, c.body, err)
		}
	}
}
