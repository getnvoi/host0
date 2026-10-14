package boxd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func serve(t *testing.T) (*Server, func(method, path, body string) (*http.Response, string)) {
	s := &Server{Token: "t", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return s, func(method, path, body string) (*http.Response, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set(TokenHeader, "t")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		return res, string(b)
	}
}

// Follows a run's log to its end.
func follow(t *testing.T, do func(method, path, body string) (*http.Response, string), id string) (string, string) {
	var out strings.Builder
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); {
		res, b := do("GET", "/run/"+id+"/log?offset="+strconv.Itoa(out.Len()), "")
		out.WriteString(b)
		if exit := res.Header.Get("X-Exit"); exit != "" {
			return out.String(), exit
		}
	}
	t.Fatalf("run %s did not end: %q", id, out.String())
	return "", ""
}

func TestRecover(t *testing.T) {
	root := t.TempDir()
	write := func(id, name, data string) {
		os.MkdirAll(filepath.Join(root, id), 0o755)
		os.WriteFile(filepath.Join(root, id, name), []byte(data), 0o644)
	}
	write("a", "log", "one\n")
	write("b", "log", "two\n")
	write("b", "exit", "")
	write("c", "log", "three\n")
	write("c", "exit", "0")
	write("d", "pid", "1")
	s := &Server{Token: "t", Root: root}
	if err := s.Recover(); err != nil {
		t.Fatal(err)
	}
	read := func(id, name string) string {
		b, _ := os.ReadFile(filepath.Join(root, id, name))
		return string(b)
	}
	for id, log := range map[string]string{"a": "one\n", "b": "two\n"} {
		if read(id, "exit") != "137" || read(id, "log") != log+"lost: boxd restarted\n" {
			t.Fatalf("%s: exit %q log %q", id, read(id, "exit"), read(id, "log"))
		}
	}
	if read("c", "exit") != "0" || read("c", "log") != "three\n" {
		t.Fatalf("finished run changed: %q %q", read("c", "exit"), read("c", "log"))
	}
	if _, err := os.Stat(filepath.Join(root, "d", "exit")); err == nil {
		t.Fatal("exit written for a run without a log")
	}
}

func TestLost(t *testing.T) {
	s, do := serve(t)
	os.MkdirAll(filepath.Join(s.Root, "gone"), 0o755)
	os.WriteFile(filepath.Join(s.Root, "gone", "log"), []byte("half"), 0o644)
	start := time.Now()
	out, exit := follow(t, do, "gone")
	if out != "half" || exit != "137" || time.Since(start) > 5*time.Second {
		t.Fatalf("got %q exit %q after %v", out, exit, time.Since(start))
	}
	if res, _ := do("GET", "/run/none/log", ""); res.StatusCode != 404 {
		t.Fatalf("unknown run: %d", res.StatusCode)
	}
	if res, _ := do("GET", "/run/gone/log?offset=-1", ""); res.StatusCode != 400 {
		t.Fatalf("negative offset: %d", res.StatusCode)
	}
}

func TestStartFailure(t *testing.T) {
	_, do := serve(t)
	if res, _ := do("PUT", "/run/bad", `{"argv":["/nonexistent/binary"]}`); res.StatusCode != 201 {
		t.Fatalf("start: %d", res.StatusCode)
	}
	out, exit := follow(t, do, "bad")
	if exit != "127" || !strings.Contains(out, "/nonexistent/binary") {
		t.Fatalf("got %q exit %q", out, exit)
	}
}

func TestLogLimit(t *testing.T) {
	_, do := serve(t)
	size := logLimit + logLimit/2
	do("PUT", "/run/big", `{"argv":["sh","-c","head -c `+strconv.Itoa(size)+` /dev/zero"]}`)
	// Waits for the end, so both reads below see the whole log.
	for {
		res, _ := do("GET", "/run/big/log?offset="+strconv.Itoa(size), "")
		if res.Header.Get("X-Exit") != "" {
			break
		}
	}
	res, b := do("GET", "/run/big/log", "")
	if len(b) != logLimit || res.Header.Get("X-Exit") != "" {
		t.Fatalf("first read: %d bytes, exit %q", len(b), res.Header.Get("X-Exit"))
	}
	res, b = do("GET", "/run/big/log?offset="+strconv.Itoa(logLimit), "")
	if len(b) != size-logLimit || res.Header.Get("X-Exit") != "0" {
		t.Fatalf("second read: %d bytes, exit %q", len(b), res.Header.Get("X-Exit"))
	}
}

func TestCancel(t *testing.T) {
	defer func(g time.Duration) { grace = g }(grace)
	grace = 300 * time.Millisecond
	_, do := serve(t)
	// Ignores SIGTERM, so only the SIGKILL after grace ends it.
	do("PUT", "/run/stubborn", `{"argv":["sh","-c","trap '' TERM; echo ready; while :; do sleep 0.1; done"]}`)
	for {
		if _, b := do("GET", "/run/stubborn/log", ""); strings.Contains(b, "ready") {
			break
		}
	}
	if res, _ := do("DELETE", "/run/stubborn", ""); res.StatusCode != 204 {
		t.Fatalf("cancel: %d", res.StatusCode)
	}
	if _, exit := follow(t, do, "stubborn"); exit != "137" {
		t.Fatalf("exit %q", exit)
	}
	if res, _ := do("DELETE", "/run/stubborn", ""); res.StatusCode != 409 {
		t.Fatalf("cancel after the end: %d", res.StatusCode)
	}
}

func TestEnviron(t *testing.T) {
	t.Setenv("HZ_BOX_TOKEN", "secret")
	for _, kv := range command(Run{Argv: []string{"true"}}).Env {
		if strings.HasPrefix(kv, "HZ_BOX_TOKEN=") {
			t.Fatal("token passed to the child")
		}
	}
}

func TestRekey(t *testing.T) {
	s := &Server{Token: "env", Root: t.TempDir()}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	put := func(token, body string) int {
		req, _ := http.NewRequest("PUT", srv.URL+"/token", strings.NewReader(body))
		req.Header.Set(TokenHeader, token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	actor := strings.Repeat("a", 64)
	if put("wrong", actor) != 401 || put("env", "short") != 400 || put("env", actor) != 204 {
		t.Fatal("rekey answers")
	}
	if put("env", actor) != 401 {
		t.Fatal("the environment token still opens a rekeyed boxd")
	}
	if put(actor, actor) != 204 {
		t.Fatal("the new token does not open it")
	}
}

func TestRecoverKillsLostGroup(t *testing.T) {
	root := t.TempDir()
	cmd := exec.Command("sleep", "30")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	d := filepath.Join(root, "turn-1")
	os.MkdirAll(d, 0o755)
	os.WriteFile(filepath.Join(d, "log"), nil, 0o644)
	os.WriteFile(filepath.Join(d, "pid"), []byte(strconv.Itoa(cmd.Process.Pid)), 0o644)
	if err := (&Server{Token: "t", Root: root}).Recover(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		cmd.Process.Kill()
		t.Fatal("the lost run's group still runs")
	}
}
