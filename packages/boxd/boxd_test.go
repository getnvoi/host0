package boxd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestRunAndFollow(t *testing.T) {
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	do := func(method, path, body string) *http.Response {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set(TokenHeader, "t")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if res := do("PUT", "/run/a", `{"argv":["sh","-c","echo one; sleep 0.3; echo two; exit 3"]}`); res.StatusCode != 201 {
		t.Fatalf("start: %d", res.StatusCode)
	}
	var out strings.Builder
	offset, exit := 0, ""
	for exit == "" {
		res := do("GET", "/run/a/log?offset="+strconv.Itoa(offset), "")
		b, _ := io.ReadAll(res.Body)
		out.Write(b)
		offset += len(b)
		exit = res.Header.Get("X-Exit")
	}
	if out.String() != "one\ntwo\n" || exit != "3" {
		t.Fatalf("got %q exit %q", out.String(), exit)
	}
	if res := do("PUT", "/run/a", `{"argv":["true"]}`); res.StatusCode != 200 {
		t.Fatalf("second start of the same id: %d", res.StatusCode)
	}
	req, _ := http.NewRequest("GET", srv.URL+"/run/a/log", nil)
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != 401 {
		t.Fatalf("no token: %d", res.StatusCode)
	}
}
