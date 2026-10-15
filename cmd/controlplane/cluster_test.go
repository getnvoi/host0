package main

import (
	"context"
	"encoding/json"
	"net/url"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/kube"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/shared/seal"
)

func TestShape(t *testing.T) {
	_, h := handler(t)
	jar := map[string]string{"Cookie": "h0_session=" + signIn(t, h, "laptop").Value, "X-Requested-With": "h0"}
	shape := `{"workers":{"type":"cx33","location":"nbg1","max":4,"idle":60000000000},"tiers":[{"name":"small","cpu":"1","memory":"2Gi","cpuRequest":"250m","default":true}],"actors":{"pause":600000000000,"suspend":3600000000000}}`
	if res := call(h, "PUT", "app-dev.nvoi.to", "/api/cluster/shape", shape, jar); res.Code != 404 {
		t.Fatalf("a browser wrote the shape: %d %s", res.Code, res.Body)
	}
	if res := call(h, "PUT", "api-dev.nvoi.to", "/cluster/shape", shape, bearer); res.Code != 204 {
		t.Fatalf("put: %d %s", res.Code, res.Body)
	}
	res := call(h, "GET", "app-dev.nvoi.to", "/api/cluster/shape", "", jar)
	var got sandbox.Shape
	json.Unmarshal(res.Body.Bytes(), &got)
	want := sandbox.Shape{Workers: sandbox.Servers{Type: "cx33", Location: "nbg1", Max: 4, Idle: time.Minute},
		Tiers:  []sandbox.Tier{{Name: "small", CPU: "1", Memory: "2Gi", CPURequest: "250m", Default: true}},
		Actors: sandbox.Rest{Pause: 10 * time.Minute, Suspend: time.Hour}}
	if res.Code != 200 || !reflect.DeepEqual(got, want) {
		t.Fatalf("get: %d %s", res.Code, res.Body)
	}
	rest := `,"actors":{"pause":600000000000,"suspend":3600000000000}}`
	for body, said := range map[string]string{
		`{"workers":{"type":"cx33","location":"nbg1","max":4,"idle":0},"tiers":[]` + rest:                                                               "no default tier",
		`{"workers":{"type":"cx33","location":"nbg1","max":-1,"idle":0},"tiers":` + tiers(t) + rest:                                                     "cannot be negative",
		`{"workers":{"type":"cx33","location":"nbg1","max":1,"idle":0,"zone":"x"},"tiers":` + tiers(t) + rest:                                           "zone",
		`{"workers":{"type":"cx33","location":"nbg1","max":1,"idle":0},"tiers":` + tiers(t) + `,"actors":{"pause":600000000000,"suspend":60000000000}}`: "at least as long",
	} {
		if res := call(h, "PUT", "api-dev.nvoi.to", "/cluster/shape", body, bearer); res.Code != 400 || !strings.Contains(detail(res), said) {
			t.Errorf("%s: %d %s", body, res.Code, detail(res))
		}
	}
}

func tiers(t *testing.T) string {
	b, err := json.Marshal(sandbox.DefaultTiers)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

type pods struct{ tail int }

func (pods) List(_ context.Context, node string) ([]kube.Pod, error) {
	all := []kube.Pod{{Namespace: "h0", Name: "plane-1", Node: "c1", Phase: "Running"}, {Namespace: "wt-1", Name: "w", Node: "w1"}}
	if node == "" {
		return all, nil
	}
	return all[1:], nil
}

func (p *pods) Log(_ context.Context, ns, pod, container string, tail int) (string, error) {
	p.tail = tail
	return ns + "/" + pod + "/" + container + "\n", nil
}

func TestPods(t *testing.T) {
	p, h := handler(t)
	if res := call(h, "GET", "api-dev.nvoi.to", "/cluster/pods", "", bearer); res.Code != 422 || detail(res) != errNoPods.Error() {
		t.Fatalf("no pods: %d %s", res.Code, detail(res))
	}
	ps := &pods{}
	p.Pods = ps
	res := call(h, "GET", "api-dev.nvoi.to", "/cluster/pods?node=w1", "", bearer)
	var got []kube.Pod
	if json.Unmarshal(res.Body.Bytes(), &got); res.Code != 200 || len(got) != 1 || got[0].Namespace != "wt-1" {
		t.Fatalf("pods: %d %s", res.Code, res.Body)
	}
	res = call(h, "GET", "api-dev.nvoi.to", "/cluster/pods/h0/plane-1/log?container=plane", "", bearer)
	if res.Code != 200 || !strings.Contains(res.Body.String(), `"log":"h0/plane-1/plane\n"`) || ps.tail != 200 {
		t.Fatalf("log: %d %s, tail %d", res.Code, res.Body, ps.tail)
	}
	if res := call(h, "GET", "api-dev.nvoi.to", "/cluster/pods/h0/plane-1/log?tail=0", "", bearer); res.Code != 400 {
		t.Fatalf("tail 0: %d %s", res.Code, res.Body)
	}
}

// The plane measures its own file, for the CLI and for a browser alike.
func TestClusterDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "h0.db")
	gdb, err := db.Open(path, seal.Mint())
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
	p, h := serve(gdb, nil, nil, nil)
	t.Cleanup(p.ws.Wait)
	if res := call(h, "GET", "api-dev.nvoi.to", "/cluster/db", "", bearer); res.Code != 422 || detail(res) != errNoDB.Error() {
		t.Fatalf("no file: %d %s", res.Code, detail(res))
	}
	p.DBPath = path
	e := db.Environment{Name: "checkout-service", Repo: "acme/checkout", Branch: "main",
		Secrets: []db.Secret{{Key: "TOKEN", Value: "ghp_x"}}}
	if err := gdb.Create(&e).Error; err != nil {
		t.Fatal(err)
	}
	jar := map[string]string{"Cookie": "h0_session=" + signIn(t, h, "laptop").Value}
	for _, c := range []struct {
		host, target string
		head         map[string]string
	}{{"api-dev.nvoi.to", "/cluster/db", bearer}, {"app-dev.nvoi.to", "/api/cluster/db", jar}} {
		res := call(h, "GET", c.host, c.target, "", c.head)
		var got db.AtRest
		json.Unmarshal(res.Body.Bytes(), &got)
		// The schema, the prefix, the sealed secret, the name and the repo.
		if res.Code != 200 || !got.OK || got.Sealed != 1 || got.Markers != 5 || got.Found != 0 {
			t.Fatalf("%s: %d %s", c.host, res.Code, res.Body)
		}
	}
}

func TestPreviews(t *testing.T) {
	p, h := handler(t)
	link := func(host string) (int, string) {
		res := call(h, "POST", "api-dev.nvoi.to", "/previews", `{"host":"`+host+`"}`, bearer)
		var out struct{ URL string }
		json.Unmarshal(res.Body.Bytes(), &out)
		if res.Code != 200 {
			return res.Code, detail(res)
		}
		return res.Code, out.URL
	}
	routed := p.ws.Preview("web")
	routeTo(t, p, routed, sandbox.Route{Actor: "web-1", Port: 3000, Tier: "medium"})
	if code, u := link(routed); code != 200 || !strings.HasPrefix(u, "https://"+routed+"/?token=") {
		t.Fatalf("routed: %d %s", code, u)
	}
	forking := p.ws.Preview("f1")
	sessionRow(t, p, "web", db.Session{PublicID: "f1", State: "forking", Preview: forking})
	if code, u := link(forking); code != 200 || !strings.HasPrefix(u, "https://"+forking+"/") {
		t.Fatalf("forking: %d %s", code, u)
	}
	nowhere := p.ws.Preview("x9")
	if code, said := link(nowhere); code != 404 || !strings.Contains(said, nowhere) {
		t.Fatalf("unrouted: %d %s", code, said)
	}
	if code, said := link(""); code != 400 {
		t.Fatalf("no host: %d %s", code, said)
	}

	// Past the gate, a host routed nowhere is not found.
	u, _ := url.Parse(p.gate.URL(nowhere, time.Minute))
	if res := call(h, "GET", nowhere, "/", "", map[string]string{"x-h0-token": u.Query().Get("token")}); res.Code != 404 {
		t.Fatalf("unrouted host: %d %s", res.Code, res.Body)
	}
}
