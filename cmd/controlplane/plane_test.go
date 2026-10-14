package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/edge"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/seal"
	"github.com/getnvoi/host0/internal/workers"
	"github.com/getnvoi/host0/internal/workspace"
)

// The plane's database in a fresh file, holding the shape install writes.
func newDB(t *testing.T) *gorm.DB {
	gdb, err := db.Open(filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if s, err := gdb.DB(); err == nil {
			s.Close()
		}
	})
	if err := db.Migrate(gdb); err != nil {
		t.Fatal(err)
	}
	if err := (&workers.Scaler{DB: gdb}).SetShape(sandbox.Shape{Workers: sandbox.Servers{Type: "ccx23", Location: "fsn1",
		Max: 2, Idle: time.Minute}, Tiers: sandbox.DefaultTiers}); err != nil {
		t.Fatal(err)
	}
	return gdb
}

// Routes host to rt, as a fork or a seed build does.
func routeTo(t *testing.T, p *plane, host string, rt sandbox.Route) {
	t.Helper()
	if err := p.DB.Create(&db.Route{Host: host, Actor: rt.Actor, Port: rt.Port, Tier: rt.Tier}).Error; err != nil {
		t.Fatal(err)
	}
}

// Declares e, as PUT /environments/{name} does.
func putEnv(t *testing.T, p *plane, e workspace.Environment) {
	t.Helper()
	if err := p.ws.PutEnvironment(workspace.EnvironmentInput(e)); err != nil {
		t.Fatal(err)
	}
}

var bearer = map[string]string{"Authorization": "Bearer cli-token"}

// The plane on gdb and sb, with its handler for api-dev.nvoi.to and app-dev.nvoi.to; its CLI token is cli-token.
func serve(gdb *gorm.DB, sb sandbox.Sandboxes, pools workers.Pools, e edge.Router) (*plane, http.Handler) {
	if e == nil {
		e = checking{}
	}
	p := wire(gdb, sb, pools, e, "dev", "nvoi.to", "-preview", "box")
	p.ws.Pin = func(_ context.Context, image string) (string, error) { return image, nil }
	sum := sha256.Sum256([]byte("cli-token"))
	return p, p.Handler("api-dev.nvoi.to", "app-dev.nvoi.to", hex.EncodeToString(sum[:]))
}

func handler(t *testing.T) (*plane, http.Handler) {
	p, h := serve(newDB(t), nil, nil, nil)
	// Runs before newDB's cleanup closes the database a decision may still be writing.
	t.Cleanup(p.ws.Wait)
	return p, h
}

func call(h http.Handler, method, host, target string, body string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Host = host
	for k, v := range header {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

// The cookie of a browser signed in with a link the CLI asked for.
func signIn(t *testing.T, h http.Handler, label string) *http.Cookie {
	t.Helper()
	res := call(h, "POST", "api-dev.nvoi.to", "/login-links", `{"label":"`+label+`"}`, bearer)
	var out struct{ URL string }
	json.NewDecoder(res.Body).Decode(&out)
	cookies := call(h, "GET", "app-dev.nvoi.to", strings.TrimPrefix(out.URL, "https://app-dev.nvoi.to"), "", nil).Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("signed in with %v", cookies)
	}
	return cookies[0]
}

// The sentence of a problem the plane answered, or the whole body when it is not one.
func detail(res *httptest.ResponseRecorder) string {
	var p struct{ Detail string }
	if !strings.HasPrefix(res.Header().Get("Content-Type"), "application/problem+json") ||
		json.Unmarshal(res.Body.Bytes(), &p) != nil {
		return res.Body.String()
	}
	return p.Detail
}

type checking map[string]error

func (c checking) Route(context.Context, string) error        { return nil }
func (c checking) Check(_ context.Context, host string) error { return c[host] }

// Records the actors deleted.
type removing struct {
	sandbox.Sandboxes
	mu   sync.Mutex
	gone []string
}

func (r *removing) Delete(_ context.Context, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gone = append(r.gone, name)
	return nil
}

// A sandbox whose every port is one boxd stand-in.
type boxed struct {
	sandbox.Sandboxes
	addr string
}

func (b boxed) State(context.Context, string) (string, error) { return "running", nil }
func (b boxed) Dial(ctx context.Context, _ string, _ int) (net.Conn, error) {
	return (&net.Dialer{}).DialContext(ctx, "tcp", b.addr)
}

type fakeSandboxes struct {
	sandbox.Sandboxes
	workers []sandbox.Worker
	states  map[string]string
}

func (f *fakeSandboxes) State(_ context.Context, a string) (string, error) { return f.states[a], nil }
func (f *fakeSandboxes) Workers(context.Context) ([]sandbox.Worker, error) { return f.workers, nil }

type fakePools struct {
	workers.Pools
	replicas, ready map[string]int
	nodes           []kube.Node
}

func (f *fakePools) Replicas(_ context.Context, pool string) (int, error) {
	return f.replicas[pool], nil
}
func (f *fakePools) Ready(_ context.Context, pool string) (int, error) { return f.ready[pool], nil }
func (f *fakePools) Nodes(context.Context) ([]kube.Node, error)        { return f.nodes, nil }

var testLLM = workspace.LLMConfigInput{Name: "Claude Code", Provider: "claude_code", Main: true, Values: map[string]string{"kind": "oauth", "token": "t"}}

func TestLogin(t *testing.T) {
	_, h := handler(t)
	res := call(h, "POST", "api-dev.nvoi.to", "/login-links", `{"label":"laptop"}`, bearer)
	var out struct{ URL string }
	json.NewDecoder(res.Body).Decode(&out)
	if res.Code != 200 || !strings.HasPrefix(out.URL, "https://app-dev.nvoi.to/login?code=") {
		t.Fatalf("link: %d %q", res.Code, out.URL)
	}
	path := strings.TrimPrefix(out.URL, "https://app-dev.nvoi.to")

	first := call(h, "GET", "app-dev.nvoi.to", path, "", nil)
	cookie := first.Result().Cookies()
	if first.Code != 302 || len(cookie) != 1 || !cookie[0].HttpOnly || !cookie[0].Secure {
		t.Fatalf("first use: %d %v", first.Code, cookie)
	}
	if again := call(h, "GET", "app-dev.nvoi.to", path, "", nil); again.Header().Get("Location") != "/login?expired=1" {
		t.Fatalf("second use of the same link was not refused: %d %v", again.Code, again.Header())
	}

	jar := map[string]string{"Cookie": cookie[0].Name + "=" + cookie[0].Value}
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/me", "", jar); res.Code != 200 {
		t.Fatalf("me with cookie: %d", res.Code)
	}
	if res := call(h, "GET", "app-dev.nvoi.to", "/api/me", "", nil); res.Code != 401 {
		t.Fatalf("me without cookie: %d", res.Code)
	}
	if res := call(h, "POST", "app-dev.nvoi.to", "/api/sessions", `{}`, jar); res.Code != 403 {
		t.Fatalf("write without X-Requested-With: %d", res.Code)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/me", "", jar); res.Code != 401 {
		t.Fatalf("the API host took a browser cookie: %d", res.Code)
	}
}

func TestSignOut(t *testing.T) {
	_, h := handler(t)
	cookie := signIn(t, h, "laptop")
	jar := map[string]string{"Cookie": cookie.Name + "=" + cookie.Value}

	res := call(h, "GET", "api-dev.nvoi.to", "/browsers", "", bearer)
	var bs []struct{ Label string }
	json.Unmarshal(res.Body.Bytes(), &bs)
	if res.Code != 200 || len(bs) != 1 || bs[0].Label != "laptop" || strings.Contains(res.Body.String(), cookie.Value) {
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

func TestEnvironmentCRUD(t *testing.T) {
	sb := &removing{}
	p, h := serve(newDB(t), sb, nil, nil)
	api := func(method, path, body string) (int, string) {
		res := call(h, method, "api-dev.nvoi.to", path, body, bearer)
		return res.Code, res.Body.String()
	}
	if code, body := api("PUT", "/environments/web", `{"repo":"o/r","branch":"main","image":"ruby","preview":3000,
		"secrets":{"TOKEN":"s1"},"tools":{"push_branch":"approval"}}`); code != 204 {
		t.Fatalf("put: %d %s", code, body)
	}
	code, body := api("GET", "/environments/web", "")
	var e workspace.Environment
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
	stored, err := p.ws.Environment("web")
	if err != nil || stored.Image != "ruby:3" || !reflect.DeepEqual(stored.Env, map[string]string{"B": "2"}) ||
		stored.Tools["push_branch"] != "deny" || secret(t, p, "TOKEN") != "s1" || stored.Preview != 3000 {
		t.Fatalf("after patches: %+v %v", stored, err)
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
	if v := secret(t, p, "TOKEN"); v != "s1" {
		t.Fatalf("put back lost the secret: %q", v)
	}

	sessionRow(t, p, "web", db.Session{PublicID: "s1", State: "idle"})
	if code, body := api("DELETE", "/environments/web", ""); code != 409 || !strings.Contains(body, "s1") {
		t.Fatalf("delete under a session: %d %s", code, body)
	}
	p.DB.Unscoped().Where("public_id = ?", "s1").Delete(&db.Session{})
	seedRow(t, p, "web", db.Seed{Actor: "tpl-a", State: "ready"})
	seedRow(t, p, "web", db.Seed{Actor: "tpl-b", State: "building"})
	routeTo(t, p, p.ws.Preview("web"), sandbox.Route{Actor: "tpl-a", Port: 3000, Tier: "medium"})
	if code, body := api("DELETE", "/environments/web", ""); code != 204 {
		t.Fatalf("delete: %d %s", code, body)
	}
	if !reflect.DeepEqual(sb.gone, []string{"tpl-b", "tpl-a"}) {
		t.Fatalf("actors deleted: %v", sb.gone)
	}
	var seeds int64
	if _, err := p.ws.Route(p.ws.Preview("web")); !errors.As(err, new(workspace.NotFound)) || p.DB.Model(&db.Seed{}).Count(&seeds).Error != nil || seeds != 0 {
		t.Fatal("route or seed left behind")
	}
	if code, _ := api("GET", "/environments/web", ""); code != 404 {
		t.Fatalf("get after delete: %d", code)
	}
}

// Writes s as a seed row of the environment named.
func seedRow(t *testing.T, p *plane, env string, s db.Seed) {
	t.Helper()
	var e db.Environment
	if err := p.DB.Where("name = ?", env).First(&e).Error; err != nil {
		t.Fatal(err)
	}
	s.EnvironmentID = e.ID
	if err := p.DB.Create(&s).Error; err != nil {
		t.Fatal(err)
	}
}

// Writes s as a session row of the environment named, declared first when it is not.
func sessionRow(t *testing.T, p *plane, env string, s db.Session) db.Session {
	t.Helper()
	var e db.Environment
	if p.DB.Where("name = ?", env).First(&e).Error != nil {
		putEnv(t, p, workspace.Environment{Name: env})
		if err := p.DB.Where("name = ?", env).First(&e).Error; err != nil {
			t.Fatal(err)
		}
	}
	a := db.Agent{Slug: "hz"}
	if err := p.DB.Where(&a).Attrs(db.Agent{Name: "hz"}).FirstOrCreate(&a).Error; err != nil {
		t.Fatal(err)
	}
	s.EnvironmentID, s.AgentID = e.ID, a.ID
	if err := p.DB.Create(&s).Error; err != nil {
		t.Fatal(err)
	}
	return s
}

// Writes a as an approval's row of its session.
func approvalRow(t *testing.T, p *plane, a workspace.Approval) {
	t.Helper()
	var s db.Session
	if err := p.DB.Unscoped().Where("public_id = ?", a.Session).First(&s).Error; err != nil {
		t.Fatal(err)
	}
	r := db.Approval{PublicID: a.ID, SessionID: s.ID, Turn: a.Turn, Tool: a.Tool, State: a.State, AskedAt: a.At}
	if a.Input != "" {
		r.Input = json.RawMessage(a.Input)
	}
	if a.Outcome != "" {
		r.Outcome, _ = json.Marshal(a.Outcome)
	}
	if !a.Decided.IsZero() {
		r.DecidedAt = &a.Decided
	}
	if a.By != "" {
		m := db.Member{AccountID: "local:" + a.By, Login: a.By, Role: "operator"}
		if err := p.DB.Where(db.Member{AccountID: m.AccountID}).FirstOrCreate(&m).Error; err != nil {
			t.Fatal(err)
		}
		r.DecidedByID = &m.ID
	}
	if err := p.DB.Where("public_id = ?", a.ID).Assign(r).FirstOrCreate(&db.Approval{}).Error; err != nil {
		t.Fatal(err)
	}
}

// The value the database holds for the secret named.
func secret(t *testing.T, p *plane, name string) string {
	t.Helper()
	var s db.Secret
	if err := p.DB.Where("key = ?", name).First(&s).Error; err != nil {
		t.Fatal(err)
	}
	return s.Value
}

func TestSessionDelete(t *testing.T) {
	sb := &removing{}
	p, h := serve(newDB(t), sb, nil, nil)
	sessionRow(t, p, "web", db.Session{PublicID: "r1", State: "running"})
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/sessions/r1", "", bearer); res.Code != 409 {
		t.Fatalf("delete while running: %d %s", res.Code, res.Body)
	}
	s := sessionRow(t, p, "web", db.Session{PublicID: "d1", State: "awaiting_approval", Preview: p.ws.Preview("d1")})
	routeTo(t, p, s.Preview, sandbox.Route{Actor: "wt-d1", Port: 3000, Tier: "medium"})
	if err := p.DB.Create(&db.QueuedMessage{SessionID: s.ID, Text: "next"}).Error; err != nil {
		t.Fatal(err)
	}
	approvalRow(t, p, workspace.Approval{ID: "a1", Session: "d1", State: "pending"})
	approvalRow(t, p, workspace.Approval{ID: "a2", Session: "d1", State: "deciding"})
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/sessions/d1", "", bearer); res.Code != 409 {
		t.Fatalf("delete while deciding: %d %s", res.Code, res.Body)
	}
	approvalRow(t, p, workspace.Approval{ID: "a2", Session: "d1", State: "done"})
	if res := call(h, "DELETE", "api-dev.nvoi.to", "/sessions/d1", "", bearer); res.Code != 204 {
		t.Fatalf("delete: %d %s", res.Code, res.Body)
	}
	a, _ := p.ws.Approval("a1")
	if a.State != "stopped" || !reflect.DeepEqual(sb.gone, []string{"wt-d1"}) {
		t.Fatalf("approval %s, deleted %v", a.State, sb.gone)
	}
	var queued int64
	if p.DB.Model(&db.QueuedMessage{}).Count(&queued); queued != 0 {
		t.Errorf("%d queued messages left behind", queued)
	}
	var kept db.Session
	if err := p.DB.Unscoped().Where("public_id = ?", "d1").First(&kept).Error; err != nil || !kept.DeletedAt.Valid {
		t.Errorf("the session's row is not kept removed: %+v %v", kept, err)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/sessions/d1", "", bearer); res.Code != 404 {
		t.Fatalf("get after delete: %d", res.Code)
	}
}

func TestCredentialsRead(t *testing.T) {
	_, h := handler(t)
	stored := func() []string {
		res := call(h, "GET", "api-dev.nvoi.to", "/credentials", "", bearer)
		var c workspace.CredentialsSet
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

func TestClusterStatus(t *testing.T) {
	pools := &fakePools{replicas: map[string]int{"hz-medium": 2}, ready: map[string]int{"hz-medium": 1}, nodes: []kube.Node{{Name: "w1", Ready: true}}}
	sb := &fakeSandboxes{workers: []sandbox.Worker{{Pool: "hz-medium", Pod: "p1", Held: []sandbox.Held{{Name: "a", State: "running"}}}}}
	_, h := serve(newDB(t), sb, pools, checking{"app-dev.nvoi.to": errors.New("app-dev.nvoi.to has no record")})
	res := call(h, "GET", "api-dev.nvoi.to", "/cluster", "", bearer)
	var c workers.Cluster
	json.Unmarshal(res.Body.Bytes(), &c)
	if res.Code != 200 || c.Name != "dev" || len(c.Nodes) != 1 || len(c.Pools) != 3 || len(c.Workers) != 1 {
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

func TestApprovalShow(t *testing.T) {
	p, h := handler(t)
	at := time.Date(2026, 10, 14, 9, 30, 0, 0, time.UTC)
	sessionRow(t, p, "web", db.Session{PublicID: "s1", State: "idle"})
	approvalRow(t, p, workspace.Approval{ID: "ap1", Session: "s1", Tool: "push_branch",
		Input: `{"branch":"fix-cart"}`, State: "done", Outcome: "pushed fix-cart", Decided: at, By: "ben"})
	res := call(h, "GET", "api-dev.nvoi.to", "/approvals/ap1", "", bearer)
	var a workspace.Approval
	json.NewDecoder(res.Body).Decode(&a)
	if res.Code != 200 || a.By != "ben" || !a.Decided.Equal(at) || a.Outcome != "pushed fix-cart" {
		t.Fatalf("%d %+v", res.Code, a)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/approvals/nope", "", bearer); res.Code != http.StatusNotFound {
		t.Fatalf("unknown approval: %d %s", res.Code, res.Body.String())
	}
}

// A second click on an approval, or a second build of a seed, is a conflict.
func TestConflicts(t *testing.T) {
	p, h := handler(t)
	sessionRow(t, p, "web", db.Session{PublicID: "d2", State: "idle"})
	approvalRow(t, p, workspace.Approval{ID: "b1", Session: "d2", Tool: "push_branch", State: "pending"})
	if res := call(h, "POST", "api-dev.nvoi.to", "/approvals/b1/deny", "", bearer); res.Code != http.StatusAccepted {
		t.Fatalf("first click %d %s", res.Code, res.Body.String())
	}
	if res := call(h, "POST", "api-dev.nvoi.to", "/approvals/b1/deny", "", bearer); res.Code != http.StatusConflict {
		t.Fatalf("second click %d %s", res.Code, res.Body.String())
	}
}

func TestConfigSecrets(t *testing.T) {
	p, h := handler(t)
	res := call(h, "POST", "api-dev.nvoi.to", "/llm/configs",
		`{"name":"work","provider":"claude_code","values":{"kind":"api_key","token":"sk-1"}}`, bearer)
	if res.Code != 200 || strings.Contains(res.Body.String(), "sk-1") {
		t.Fatalf("add: %d %s", res.Code, res.Body)
	}
	res = call(h, "PUT", "api-dev.nvoi.to", "/llm/configs/work", `{"values":{"kind":"api_key","token":"","model":"opus"}}`, bearer)
	var c workspace.LLMConfig
	json.Unmarshal(res.Body.Bytes(), &c)
	if res.Code != 200 || !reflect.DeepEqual(c.Stored, []string{"token"}) || c.Values["model"] != "opus" || c.Values["token"] != "" {
		t.Fatalf("update: %d %s", res.Code, res.Body)
	}
	var stored db.LLMConfig
	if p.DB.Where("name = ?", "work").First(&stored); stored.Values["token"] != "sk-1" {
		t.Fatalf("an empty secret keeps the stored one: %v", stored.Values)
	}
	res = call(h, "POST", "api-dev.nvoi.to", "/llm/configs", `{"name":"x","provider":"claude_code","values":{"kind":"oauth"}}`, bearer)
	if res.Code != 400 || detail(res) != "Token is needed" {
		t.Fatalf("missing token: %d %s", res.Code, res.Body)
	}
}
