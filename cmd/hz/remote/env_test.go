package remote

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/getnvoi/host0/cmd/hz/state"
	"github.com/getnvoi/host0/internal/workspace"
)

func TestYAMLRoundTrip(t *testing.T) {
	e := workspace.Environment{Name: "web", Repo: "o/r", Branch: "main", Image: "ruby", Preview: 3000, Tier: "large",
		Env: map[string]string{"A": "1"}, Secrets: map[string]string{"TOKEN": "", "KEY": ""}, Setup: []string{"bundle"},
		Services: []workspace.Service{{Name: "web", Command: "bin/rails s", Port: 3000, Early: true, Env: map[string]string{"X": "y"}}}}
	b, err := encode(e)
	if err != nil {
		t.Fatal(err)
	}
	got, names, err := decode("web.yaml", b)
	if err != nil {
		t.Fatalf("%v\n%s", err, b)
	}
	want := e
	want.Secrets = nil
	if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(names, []string{"KEY", "TOKEN"}) {
		t.Fatalf("got %+v %v\n%s", got, names, b)
	}
}

func TestYAMLUnknownKey(t *testing.T) {
	for _, doc := range []string{"name: web\nimagee: x\n", "name: web\nservices:\n  - name: w\n    comand: x\n"} {
		_, _, err := decode("web.yaml", []byte(doc))
		if err == nil || !strings.HasPrefix(err.Error(), "web.yaml: ") {
			t.Errorf("%q: %v", doc, err)
		}
	}
}

type request struct{ method, path, body string }

// A plane answering GET /environments/web with e and recording every request.
func fake(t *testing.T, e workspace.Environment) *[]request {
	var seen []request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		seen = append(seen, request{r.Method, r.URL.Path, strings.TrimSpace(string(b))})
		if r.Method == "GET" {
			json.NewEncoder(w).Encode(e)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("HOME", t.TempDir())
	if err := state.Save(state.State{URL: srv.URL, Token: "t"}); err != nil {
		t.Fatal(err)
	}
	return &seen
}

func run(t *testing.T, args ...string) error {
	cmd := root()
	cmd.SetArgs(append([]string{"env"}, args...))
	cmd.SilenceUsage, cmd.SilenceErrors = true, true
	return cmd.Execute()
}

func TestEnvCommands(t *testing.T) {
	e := workspace.Environment{Name: "web", Env: map[string]string{"A": "1"}, Setup: []string{"one", "two"},
		Services: []workspace.Service{{Name: "web", Command: "serve", Port: 3000}}}
	for _, c := range []struct {
		args []string
		want string
	}{
		{[]string{"set", "web", "--image", "ruby:3", "--preview", "4000"}, `{"image":"ruby:3","preview":4000}`},
		{[]string{"var", "set", "web", "B", "2"}, `{"env":{"B":"2"}}`},
		{[]string{"var", "rm", "web", "A"}, `{"env":{"A":null}}`},
		{[]string{"setup", "rm", "web", "1"}, `{"setup":["two"]}`},
		{[]string{"service", "set", "web", "web", "--port", "3001"}, `{"services":[{"name":"web","command":"serve","port":3001}]}`},
		{[]string{"service", "add", "web", "worker", "--command", "jobs", "--early"},
			`{"services":[{"name":"web","command":"serve","port":3000},{"name":"worker","command":"jobs","early":true}]}`},
	} {
		seen := fake(t, e)
		if err := run(t, c.args...); err != nil {
			t.Fatalf("%v: %v", c.args, err)
		}
		last := (*seen)[len(*seen)-1]
		if last.method != "PATCH" || last.path != "/environments/web" || last.body != c.want {
			t.Errorf("%v: %+v, want PATCH %s", c.args, last, c.want)
		}
	}
	for _, args := range [][]string{{"var", "rm", "web", "Z"}, {"setup", "rm", "web", "3"}, {"service", "add", "web", "web", "--command", "x"},
		{"service", "set", "web", "nope", "--port", "1"}, {"set", "web"}} {
		seen := fake(t, e)
		if err := run(t, args...); err == nil {
			t.Errorf("%v: no error", args)
		}
		for _, r := range *seen {
			if r.method != "GET" {
				t.Errorf("%v: sent %+v", args, r)
			}
		}
	}
}
