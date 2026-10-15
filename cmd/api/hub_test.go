package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/infra"
	"github.com/getnvoi/host0/internal/shared/seal"
)

// GitHub's user token in the captured answer of /login/oauth/access_token.
const userToken = "ghu_16C7e42F292c6912E7710c838347Ae178B4a"

// A plane that keeps what it was told: its token is "plane-token".
type fakePlane struct {
	mu     sync.Mutex
	github string
	seen   []string // method path authorization
}

func (p *fakePlane) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	p.seen = append(p.seen, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization"))
	p.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer plane-token" {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(401)
		io.WriteString(w, "the plane's token is required")
		return
	}
	switch r.Method + " " + r.URL.Path {
	case "GET /me":
		io.WriteString(w, `{"cluster":"acme","zone":"hostzero.app"}`)
	case "PUT /credentials":
		var in struct {
			GitHub string `json:"github"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		p.mu.Lock()
		p.github = in.GitHub
		p.mu.Unlock()
		w.WriteHeader(204)
	case "GET /credentials":
		p.mu.Lock()
		stored := []string{}
		if p.github != "" {
			stored = append(stored, "github")
		}
		p.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"stored": stored})
	case "GET /github/repositories":
		io.WriteString(w, `[{"full_name":"octocat/Hello-World","default_branch":"master","private":false}]`)
	case "GET /stream":
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "id: 1\ndata: {\"kind\":\"reset\"}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	default:
		w.WriteHeader(404)
	}
}

type fixture struct {
	h       *hub
	srv     *httptest.Server
	plane   *fakePlane
	dbPath  string
	install chan error
}

func newHub(t *testing.T) *fixture {
	t.Helper()
	path := filepath.Join(t.TempDir(), "hub.db")
	gdb, err := db.Open(path, seal.Mint())
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(gdb); err != nil {
		t.Fatal(err)
	}
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /login/oauth/access_token":
			r.ParseForm()
			if r.Form.Get("client_secret") != "secret" || r.Form.Get("code") != "good" {
				http.ServeFile(w, r, "testdata/github-access_token-refused.json")
				return
			}
			http.ServeFile(w, r, "testdata/github-access_token.json")
		case "GET /user":
			http.ServeFile(w, r, "testdata/github-user.json")
		case "GET /user/emails":
			http.ServeFile(w, r, "testdata/github-user-emails.json")
		default:
			t.Errorf("github: %s %s", r.Method, r.URL)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(gh.Close)
	hz := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer hz" {
			t.Errorf("hetzner authorization %q", r.Header.Get("Authorization"))
		}
		http.ServeFile(w, r, "testdata/hetzner-"+strings.TrimPrefix(r.URL.Path, "/")+".json")
	}))
	t.Cleanup(hz.Close)
	plane := &fakePlane{}
	ps := httptest.NewServer(plane)
	t.Cleanup(ps.Close)
	f := &fixture{plane: plane, dbPath: path, install: make(chan error, 1)}
	f.h = &hub{DB: gdb, URL: "https://local.hostzero.app", Redirect: "h0-dev://auth", Zone: "hostzero.app", Reserved: "local",
		GitHub:       githubApp{ClientID: "Iv23li", Secret: "secret", Slug: "h0-dev", Web: gh.URL, API: gh.URL},
		HetznerToken: "hz", HetznerAPI: hz.URL,
		PlaneURL: func(Workspace) string { return ps.URL },
		Install: func(ctx context.Context, w Workspace, l infra.Laptop, out io.Writer) error {
			fmt.Fprintf(out, "[1/2] base\n  network h0-%s\n[2/2] control plane", w.Name)
			fmt.Fprintf(out, "\n")
			if err := l.SaveKey(seal.Mint()); err != nil {
				return err
			}
			if err := l.SavePlane(ps.URL, "plane-token"); err != nil {
				return err
			}
			return <-f.install
		},
		Destroy: func(ctx context.Context, w Workspace, out io.Writer) error {
			fmt.Fprintf(out, "[1/2] servers\n[2/2] edge\n")
			return nil
		}}
	f.srv = httptest.NewServer(f.h.Handler())
	t.Cleanup(f.srv.Close)
	return f
}

var noRedirect = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func (f *fixture) do(t *testing.T, method, path, token string, in any) (*http.Response, string) {
	t.Helper()
	var r io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		r = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, f.srv.URL+path, r)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := noRedirect.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

// The browser's leg: the hub's redirect to GitHub, GitHub's back with code, the hub's to the app. The app's query.
func (f *fixture) browse(t *testing.T, verifier, code string) url.Values {
	t.Helper()
	q := url.Values{"challenge": {s256(verifier)}, "method": {"S256"}, "state": {"app-state"}, "redirect": {"h0-dev://auth"}}
	res, body := f.do(t, "GET", "/v1/auth/github?"+q.Encode(), "", nil)
	if res.StatusCode != 302 {
		t.Fatalf("authorize: %d %s", res.StatusCode, body)
	}
	to, _ := url.Parse(res.Header.Get("Location"))
	if to.Path != "/login/oauth/authorize" || to.Query().Get("client_id") != "Iv23li" ||
		to.Query().Get("redirect_uri") != "https://local.hostzero.app/v1/auth/github/callback" {
		t.Fatalf("authorize at %s", to)
	}
	res, body = f.do(t, "GET", "/v1/auth/github/callback?"+url.Values{"code": {code}, "state": {to.Query().Get("state")}}.Encode(), "", nil)
	if res.StatusCode != 302 {
		t.Fatalf("callback: %d %s", res.StatusCode, body)
	}
	back, _ := url.Parse(res.Header.Get("Location"))
	if back.Scheme != "h0-dev" || back.Host != "auth" || back.Query().Get("state") != "app-state" {
		t.Fatalf("back at %s", back)
	}
	return back.Query()
}

func (f *fixture) signIn(t *testing.T) string {
	t.Helper()
	back := f.browse(t, "verifier-0123456789-0123456789-0123456789", "good")
	res, body := f.do(t, "POST", "/v1/auth/token", "", map[string]string{"code": back.Get("code"), "verifier": "verifier-0123456789-0123456789-0123456789"})
	if res.StatusCode != 200 {
		t.Fatalf("token: %d %s", res.StatusCode, body)
	}
	var out struct{ Token string }
	json.Unmarshal([]byte(body), &out)
	return out.Token
}

func refusedWith(t *testing.T, res *http.Response, body string, status int, sentence string) {
	t.Helper()
	if res.StatusCode != status || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/plain") || !strings.Contains(body, sentence) {
		t.Fatalf("got %d %s %q, want %d text/plain %q", res.StatusCode, res.Header.Get("Content-Type"), body, status, sentence)
	}
}

func TestSignIn(t *testing.T) {
	f := newHub(t)
	token := f.signIn(t)
	res, body := f.do(t, "GET", "/v1/me", token, nil)
	if res.StatusCode != 200 || body != `{"login":"octocat","name":"monalisa octocat","avatar_url":"https://github.com/images/error/octocat_happy.gif"}`+"\n" {
		t.Fatalf("me: %d %s", res.StatusCode, body)
	}
	var u User
	if err := f.h.DB.First(&u).Error; err != nil || u.Email != "octocat@github.com" || u.GitHubID != 1 {
		t.Fatalf("user %+v %v", u, err)
	}
	res, _ = f.do(t, "DELETE", "/v1/auth/token", token, nil)
	if res.StatusCode != 204 {
		t.Fatalf("sign out: %d", res.StatusCode)
	}
	res, body = f.do(t, "GET", "/v1/me", token, nil)
	refusedWith(t, res, body, 401, "Sign in with GitHub again")
	res, body = f.do(t, "GET", "/v1/me", "", nil)
	refusedWith(t, res, body, 401, "no device token")
}

// The code is bound to the challenge, and spent by its first trade: a wrong verifier burns it.
func TestCodeOnce(t *testing.T) {
	f := newHub(t)
	v := "verifier-0123456789-0123456789-0123456789"
	code := f.browse(t, v, "good").Get("code")
	res, body := f.do(t, "POST", "/v1/auth/token", "", map[string]string{"code": code, "verifier": "another-verifier"})
	refusedWith(t, res, body, 400, "This sign-in code was used")
	res, body = f.do(t, "POST", "/v1/auth/token", "", map[string]string{"code": code, "verifier": v})
	refusedWith(t, res, body, 400, "This sign-in code was used")

	code = f.browse(t, v, "good").Get("code")
	if res, body = f.do(t, "POST", "/v1/auth/token", "", map[string]string{"code": code, "verifier": v}); res.StatusCode != 200 {
		t.Fatalf("first trade: %d %s", res.StatusCode, body)
	}
	res, body = f.do(t, "POST", "/v1/auth/token", "", map[string]string{"code": code, "verifier": v})
	refusedWith(t, res, body, 400, "This sign-in code was used")
}

func TestSignInRefused(t *testing.T) {
	f := newHub(t)
	q := url.Values{"challenge": {"c"}, "method": {"S256"}, "state": {"s"}, "redirect": {"h0://auth"}}
	res, body := f.do(t, "GET", "/v1/auth/github?"+q.Encode(), "", nil)
	refusedWith(t, res, body, 400, "This hub signs in to h0-dev://auth, not h0://auth.")
	res, body = f.do(t, "GET", "/v1/auth/github/callback?code=good&state=forged", "", nil)
	refusedWith(t, res, body, 400, "This sign-in is not the hub's")
	if back := f.browse(t, "v", "stale"); back.Get("error") != "github refused the code: The code passed is incorrect or expired. (bad_verification_code)" {
		t.Fatalf("refused code: %v", back)
	}
}

// A line of the run's stream.
type message struct {
	ID          string
	Line, State string
}

func (f *fixture) follow(t *testing.T, path, token string) []message {
	t.Helper()
	req, _ := http.NewRequest("GET", f.srv.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out []message
	var m message
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "id: "):
			m.ID = strings.TrimPrefix(line, "id: ")
		case strings.HasPrefix(line, "data: "):
			var d struct{ Line, State string }
			json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &d)
			m.Line, m.State = d.Line, d.State
		case line == "" && m.ID != "":
			out = append(out, m)
			m = message{}
		}
	}
	return out
}

func TestWorkspace(t *testing.T) {
	f := newHub(t)
	token := f.signIn(t)
	res, body := f.do(t, "GET", "/v1/offer", token, nil)
	var o Offer
	json.Unmarshal([]byte(body), &o)
	if res.StatusCode != 200 || len(o.Plans) == 0 || o.Plans[0].Name != "ccx13" || o.Plans[0].CPU != 2 || o.Plans[0].HourlyCents != 11 || o.Plans[0].Label != "CCX13 · 2 vCPU, 8 GB" ||
		len(o.Locations) != 6 || o.Locations[0] != (Location{"fsn1", "Falkenstein, DE"}) {
		t.Fatalf("offer: %d %s", res.StatusCode, body)
	}
	res, body = f.do(t, "POST", "/v1/workspaces", token, WorkspaceInput{Name: "acme", Plan: "ccx99", Location: "fsn1"})
	refusedWith(t, res, body, 400, "There is no plan ccx99 on offer.")
	res, body = f.do(t, "POST", "/v1/workspaces", token, WorkspaceInput{Name: "local", Plan: "ccx23", Location: "fsn1"})
	refusedWith(t, res, body, 409, "A workspace is called local already.")
	res, body = f.do(t, "POST", "/v1/workspaces", token, WorkspaceInput{Name: "acme", Plan: "ccx23", Location: "fsn1"})
	if res.StatusCode != 201 || body != `{"name":"acme","plan":"ccx23","location":"fsn1","ready":false,"run":"1"}`+"\n" {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	res, body = f.do(t, "POST", "/v1/workspaces/acme/runs", token, nil)
	refusedWith(t, res, body, 409, "workspace acme has a run open already")
	f.install <- nil
	got := f.follow(t, "/v1/workspaces/acme/runs/1/stream", token)
	want := []message{{"0", "[1/2] base", ""}, {"1", "  network h0-acme", ""}, {"2", "[2/2] control plane", ""},
		{"3", "workspace acme is ready at https://app-acme.hostzero.app", "ok"}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("stream\n%v\nwant\n%v", got, want)
	}
	if got := f.follow(t, "/v1/workspaces/acme/runs/1/stream?from=3", token); len(got) != 1 || got[0].State != "ok" {
		t.Fatalf("from 3: %v", got)
	}
	res, body = f.do(t, "GET", "/v1/workspaces", token, nil)
	if body != `[{"name":"acme","plan":"ccx23","location":"fsn1","ready":true,"run":null}]`+"\n" {
		t.Fatalf("workspaces: %d %s", res.StatusCode, body)
	}

	// The plane holds no GitHub token until the user signs in again: then it does, and the hub none.
	res, body = f.do(t, "GET", "/v1/workspaces/acme/repositories", token, nil)
	refusedWith(t, res, body, 401, "Sign in with GitHub again: workspace acme does not hold your GitHub token yet.")
	token = f.signIn(t)
	if f.plane.github != userToken {
		t.Fatalf("the plane holds %q", f.plane.github)
	}
	res, body = f.do(t, "GET", "/v1/workspaces/acme/repositories", token, nil)
	if body != `{"install_url":"https://github.com/apps/h0-dev/installations/new","repositories":[{"full_name":"octocat/Hello-World","default_branch":"master","private":false}]}`+"\n" {
		t.Fatalf("repositories: %d %s", res.StatusCode, body)
	}
	noGitHubToken(t, f)

	// The plane's routes, under the plane's token and never the device's; a stream flows as it is written.
	res, body = f.do(t, "GET", "/v1/workspaces/acme/plane/me?x=1", token, nil)
	if res.StatusCode != 200 || body != `{"cluster":"acme","zone":"hostzero.app"}` {
		t.Fatalf("plane me: %d %s", res.StatusCode, body)
	}
	if last := f.plane.seen[len(f.plane.seen)-1]; last != "GET /me?x=1 Bearer plane-token" {
		t.Fatalf("the plane saw %q", last)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", f.srv.URL+"/v1/workspaces/acme/plane/stream", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	sres, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	first, err := bufio.NewReader(sres.Body).ReadString('\n')
	if err != nil || first != "id: 1\n" {
		t.Fatalf("stream: %q %v", first, err)
	}
	cancel()
	sres.Body.Close()

	res, body = f.do(t, "GET", "/v1/workspaces/other/plane/me", token, nil)
	refusedWith(t, res, body, 404, "You have no workspace other.")

	res, body = f.do(t, "DELETE", "/v1/workspaces/acme", token, nil)
	if res.StatusCode != 202 {
		t.Fatalf("delete: %d %s", res.StatusCode, body)
	}
	if got := f.follow(t, "/v1/workspaces/acme/runs/2/stream", token); len(got) != 3 || got[2].State != "ok" {
		t.Fatalf("destroy: %v", got)
	}
	if res, body = f.do(t, "GET", "/v1/workspaces", token, nil); body != "[]\n" {
		t.Fatalf("after destroy: %s", body)
	}
}

// A failed install ends on the failure's own sentence; POST runs starts it again.
func TestRunFails(t *testing.T) {
	f := newHub(t)
	token := f.signIn(t)
	if res, body := f.do(t, "POST", "/v1/workspaces", token, WorkspaceInput{Name: "acme", Plan: "ccx23", Location: "hel1"}); res.StatusCode != 201 {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	f.install <- errors.New("control plane: plane does not answer through the edge in 5m")
	got := f.follow(t, "/v1/workspaces/acme/runs/1/stream", token)
	if last := got[len(got)-1]; last != (message{"3", "control plane: plane does not answer through the edge in 5m", "failed"}) {
		t.Fatalf("last %v", last)
	}
	res, body := f.do(t, "POST", "/v1/workspaces/acme/runs", token, nil)
	if res.StatusCode != 201 || body != `{"id":"2"}`+"\n" {
		t.Fatalf("again: %d %s", res.StatusCode, body)
	}
	f.install <- nil
	if got := f.follow(t, "/v1/workspaces/acme/runs/2/stream?from=3", token); len(got) != 1 || got[0].State != "ok" {
		t.Fatalf("again: %v", got)
	}
}

// The user's GitHub token is in no column, and the plane's token and sealing key are sealed in theirs.
func noGitHubToken(t *testing.T, f *fixture) {
	t.Helper()
	var tables []string
	if err := f.h.DB.Raw("SELECT name FROM sqlite_master WHERE type = 'table'").Scan(&tables).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range tables {
		rows, err := f.h.DB.Raw("SELECT * FROM " + table).Rows()
		if err != nil {
			t.Fatal(err)
		}
		cols, _ := rows.Columns()
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			rows.Scan(ptrs...)
			for i, v := range vals {
				if s := fmt.Sprint(v); strings.Contains(s, userToken) || strings.Contains(s, "plane-token") {
					t.Errorf("%s.%s holds a token: %s", table, cols[i], s)
				}
			}
		}
		rows.Close()
	}
	var raw struct{ Seal, Token string }
	f.h.DB.Raw("SELECT seal, token FROM workspaces").Scan(&raw)
	if !strings.HasPrefix(raw.Seal, seal.Prefix) || !strings.HasPrefix(raw.Token, seal.Prefix) {
		t.Fatalf("not sealed: %+v", raw)
	}
	b, err := os.ReadFile(f.dbPath)
	if err != nil || strings.Contains(string(b), "octocat") {
		t.Fatalf("the file holds plaintext, or does not read: %v", err)
	}
}

// A run a stopped hub left open is failed on its last line when the hub starts.
func TestAbandon(t *testing.T) {
	f := newHub(t)
	w := Workspace{Name: "acme", UserID: 1, Plan: "ccx23", Location: "fsn1"}
	f.h.DB.Create(&w)
	r := Run{WorkspaceID: w.ID, Kind: "install", State: "running"}
	f.h.DB.Create(&r)
	f.h.DB.Create(&Line{RunID: r.ID, N: 0, Text: "[1/12] dns credentials"})
	if err := f.h.abandon(); err != nil {
		t.Fatal(err)
	}
	var last Line
	f.h.DB.Where("run_id = ?", r.ID).Order("n desc").First(&last)
	f.h.DB.First(&r, r.ID)
	if last.N != 1 || last.State != "failed" || r.State != "failed" || !strings.HasPrefix(last.Text, "the hub stopped") {
		t.Fatalf("last %+v, run %+v", last, r)
	}
}
