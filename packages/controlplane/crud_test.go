package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/getnvoi/host0/shared/contract"
)

// Records the actors deleted.
type removing struct {
	Sandboxes
	mu   sync.Mutex
	gone []string
}

func (r *removing) Delete(_ context.Context, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gone = append(r.gone, name)
	return nil
}

func TestEnvironmentCRUD(t *testing.T) {
	p, h := handler(t)
	sb := &removing{}
	p.Sandboxes = sb
	api := func(method, path, body string) (int, string) {
		res := call(h, method, "api-dev.nvoi.to", path, body, bearer)
		return res.Code, res.Body.String()
	}
	if code, body := api("PUT", "/environments/web", `{"repo":"o/r","branch":"main","image":"ruby","preview":3000,
		"secrets":{"TOKEN":"s1"},"tools":{"push_branch":"approval"}}`); code != 204 {
		t.Fatalf("put: %d %s", code, body)
	}
	code, body := api("GET", "/environments/web", "")
	var e contract.Environment
	json.Unmarshal([]byte(body), &e)
	if code != 200 || strings.Contains(body, "s1") || !reflect.DeepEqual(e.Secrets, map[string]string{"TOKEN": ""}) || e.Repo != "o/r" {
		t.Fatalf("get: %d %s", code, body)
	}
	if code, body := api("PATCH", "/environments/web", `{"image":"ruby:3","env":{"A":"1","B":"2"},"tools":{"push_branch":"deny"}}`); code != 200 || strings.Contains(body, "s1") {
		t.Fatalf("patch: %d %s", code, body)
	}
	if code, body := api("PATCH", "/environments/web", `{"env":{"A":null}}`); code != 200 {
		t.Fatalf("patch null: %d %s", code, body)
	}
	var stored contract.Environment
	p.Store.Get("environments", "web", &stored)
	if stored.Image != "ruby:3" || !reflect.DeepEqual(stored.Env, map[string]string{"B": "2"}) || stored.Tools["push_branch"] != "deny" ||
		stored.Secrets["TOKEN"] != "s1" || stored.Preview != 3000 {
		t.Fatalf("after patches: %+v", stored)
	}
	for _, bad := range []string{`{"imagee":"x"}`, `{"Image":"x"}`, `{"services":[{"name":"w","bogus":1}]}`, `{"tier":"huge"}`,
		`{"tools":{"x":"maybe"}}`, `{"secrets":{"NEW":""}}`, `{"name":"other"}`, `[1]`,
		`{"services":[{"name":"w","command":"a"},{"name":"w","command":"b"}]}`} {
		if code, body := api("PATCH", "/environments/web", bad); code != 400 {
			t.Errorf("patch %s: %d %s, want 400", bad, code, body)
		}
	}
	if code, _ := api("PATCH", "/environments/none", `{"image":"x"}`); code != 404 {
		t.Fatalf("patch of nothing: %d", code)
	}
	// What GET answers goes back through PUT without losing a secret.
	if code, body := api("PUT", "/environments/web", body); code != 204 {
		t.Fatalf("put back: %d %s", code, body)
	}
	p.Store.Get("environments", "web", &stored)
	if stored.Secrets["TOKEN"] != "s1" {
		t.Fatalf("put back lost the secret: %+v", stored.Secrets)
	}

	p.Store.Put("sessions", "s1", contract.Session{ID: "s1", Env: "web", State: "idle"})
	if code, body := api("DELETE", "/environments/web", ""); code != 409 || !strings.Contains(body, "s1") {
		t.Fatalf("delete under a session: %d %s", code, body)
	}
	p.Store.Delete("sessions", "s1")
	p.Store.Put("seeds", "web", contract.Seed{Env: "web", Actor: "tpl-b", State: "building"})
	p.Store.Put("ready", "web", contract.Seed{Env: "web", Actor: "tpl-a", State: "ready"})
	p.Store.Put("routes", p.Preview("web"), Route{"tpl-a", 3000, "medium"})
	if code, body := api("DELETE", "/environments/web", ""); code != 204 {
		t.Fatalf("delete: %d %s", code, body)
	}
	if !reflect.DeepEqual(sb.gone, []string{"tpl-b", "tpl-a"}) {
		t.Fatalf("actors deleted: %v", sb.gone)
	}
	var rt Route
	if p.Store.Get("routes", p.Preview("web"), &rt) != ErrNotFound || p.Store.Get("ready", "web", &contract.Seed{}) != ErrNotFound {
		t.Fatal("route or seed left behind")
	}
	if code, _ := api("GET", "/environments/web", ""); code != 404 {
		t.Fatalf("get after delete: %d", code)
	}
}

func TestSessionDelete(t *testing.T) {
	p, h := handler(t)
	sb := &removing{}
	p.Sandboxes = sb
	p.Store.Put("sessions", "r1", contract.Session{ID: "r1", State: "running", Actor: "wt-r1"})
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/sessions/r1", "", bearer); res.Code != 409 {
		t.Fatalf("delete while running: %d %s", res.Code, res.Body)
	}
	s := contract.Session{ID: "d1", State: "awaiting_approval", Actor: "wt-d1", Preview: p.Preview("d1")}
	p.Store.Put("sessions", "d1", s)
	p.Store.Put("routes", s.Preview, Route{"wt-d1", 3000, "medium"})
	p.Store.Put("queue", "d1", []string{"next"})
	p.Store.Put("approvals", "a1", contract.Approval{ID: "a1", Session: "d1", State: "pending"})
	p.Store.Put("approvals", "a2", contract.Approval{ID: "a2", Session: "d1", State: "deciding"})
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/sessions/d1", "", bearer); res.Code != 409 {
		t.Fatalf("delete while deciding: %d %s", res.Code, res.Body)
	}
	p.Store.Put("approvals", "a2", contract.Approval{ID: "a2", Session: "d1", State: "done"})
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/sessions/d1", "", bearer); res.Code != 204 {
		t.Fatalf("delete: %d %s", res.Code, res.Body)
	}
	var a contract.Approval
	p.Store.Get("approvals", "a1", &a)
	if a.State != "stopped" || !reflect.DeepEqual(sb.gone, []string{"wt-d1"}) {
		t.Fatalf("approval %s, deleted %v", a.State, sb.gone)
	}
	for _, kind := range []string{"sessions", "queue"} {
		if p.Store.Get(kind, "d1", &[]any{}) != ErrNotFound {
			t.Errorf("%s row left behind", kind)
		}
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/sessions/d1", "", bearer); res.Code != 404 {
		t.Fatalf("get after delete: %d", res.Code)
	}
}

func TestCredentialsRead(t *testing.T) {
	_, h := handler(t)
	stored := func() []string {
		res := call(h, "GET", "api-dev.nvoi.to", "/credentials", "", bearer)
		var c contract.CredentialsSet
		if err := json.Unmarshal(res.Body.Bytes(), &c); err != nil || res.Code != 200 || strings.Contains(res.Body.String(), "ghp_") {
			t.Fatalf("get: %d %s", res.Code, res.Body)
		}
		return c.Stored
	}
	if s := stored(); len(s) != 0 {
		t.Fatalf("nothing set: %v", s)
	}
	call(h, "PUT", "api-dev.nvoi.to", "/credentials", `{"github":"ghp_x"}`, bearer)
	if s := stored(); !reflect.DeepEqual(s, []string{"github"}) {
		t.Fatalf("github set: %v", s)
	}
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/credentials/github", "", bearer); res.Code != 204 {
		t.Fatalf("delete: %d %s", res.Code, res.Body)
	}
	if s := stored(); len(s) != 0 {
		t.Fatalf("after delete: %v", s)
	}
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/credentials/gitlab", "", bearer); res.Code != 404 {
		t.Fatalf("delete of an unknown credential: %d", res.Code)
	}
}

type checking map[string]error

func (c checking) Route(context.Context, string) error        { return nil }
func (c checking) Check(_ context.Context, host string) error { return c[host] }

func TestClusterStatus(t *testing.T) {
	p, h := handler(t)
	p.Pools = &fakePools{replicas: map[string]int{"hz-medium": 2}, ready: map[string]int{"hz-medium": 1}, held: map[string]bool{"w1": true}}
	p.Sandboxes = &fakeSandboxes{workers: []Worker{{Pool: "hz-medium", Pod: "p1", Assigned: true}}}
	p.Edge = checking{"app-dev.nvoi.to": errors.New("app-dev.nvoi.to has no record")}
	res := call(h, "GET", "api-dev.nvoi.to", "/cluster", "", bearer)
	var c contract.Cluster
	json.Unmarshal(res.Body.Bytes(), &c)
	if res.Code != 200 || c.Name != "dev" || len(c.Nodes) != 1 || !c.Nodes[0].Held || len(c.Pools) != 3 || len(c.Workers) != 1 {
		t.Fatalf("status: %d %s", res.Code, res.Body)
	}
	for _, pool := range c.Pools {
		if pool.Name == "hz-medium" && (pool.Replicas != 2 || pool.Ready != 1) {
			t.Fatalf("pool: %+v", pool)
		}
	}
	if len(c.Edge) != 2 || c.Edge[0].Error != "" || c.Edge[1].Error != "app-dev.nvoi.to has no record" {
		t.Fatalf("edge: %+v", c.Edge)
	}
}

func TestSignOut(t *testing.T) {
	_, h := handler(t)
	res := call(h, "POST", "api-dev.nvoi.to", "/login-links", `{"label":"laptop"}`, bearer)
	var out struct{ URL string }
	json.NewDecoder(res.Body).Decode(&out)
	cookie := call(h, "GET", "app-dev.nvoi.to", strings.TrimPrefix(out.URL, "https://app-dev.nvoi.to"), "", nil).Result().Cookies()
	jar := map[string]string{"Cookie": cookie[0].Name + "=" + cookie[0].Value}

	res = call(h, "GET", "api-dev.nvoi.to", "/browsers", "", bearer)
	var bs []contract.Browser
	json.Unmarshal(res.Body.Bytes(), &bs)
	if res.Code != 200 || len(bs) != 1 || bs[0].Label != "laptop" || strings.Contains(res.Body.String(), cookie[0].Value) {
		t.Fatalf("browsers: %d %s", res.Code, res.Body)
	}
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/browsers", "", jar); res.Code != 404 {
		t.Fatalf("a browser listed browsers: %d", res.Code)
	}
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/browsers/nobody", "", bearer); res.Code != 404 {
		t.Fatalf("sign out of nobody: %d", res.Code)
	}
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/browsers/laptop", "", bearer); res.Code != 200 || !strings.Contains(res.Body.String(), `"count":1`) {
		t.Fatalf("sign out: %d %s", res.Code, res.Body)
	}
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/me", "", jar); res.Code != 401 {
		t.Fatalf("me after sign out: %d", res.Code)
	}
}
