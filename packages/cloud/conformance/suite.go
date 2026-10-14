package conformance

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/shared/naming"
)

// A provider under test. Ops are read from its requests: Classify names each one's op and resource kind.
type Subject struct {
	New func(rt http.RoundTripper, say func(string, ...any), sleep cloud.Sleep) cloud.Cloud
	// testdata/<provider>.json beside the provider's test.
	Cassette string
	// The credential, when recording; scrubbed from the cassette.
	Secret         string
	Location, Type string
	// op is "create", "delete", "write" or "" for a read; kind is the resource's, "servers" for a server.
	Classify func(method, path string) (op, kind string)
	// The id a create's response names, and the id a delete's path names.
	Created func(response []byte) string
	Deleted func(path string) string
	// The tcp ports a request opens, when it writes the firewall's rules.
	Ports func(method, path string, body []byte) (ports []int, ok bool, err error)
	// Kinds whose create cannot carry the owner mark, each with the reason.
	Unmarked map[string]string
	Message  func(body []byte) string
}

const (
	cluster = "conf"
	key     = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICI1HYzQUDhIaxmM8+W5HLuG80KAjFg7N8Ilkb1v1WmR hz-conformance"
	// The cloud-init a worker gets; a real one holds the cluster's join token.
	cloudInit = "#cloud-config\nruncmd:\n  - [true]\n"
)

var open = []int{80, 443}

// An event in order: a Say, or a request served.
type event struct {
	say string
	req *Interaction
}

// HZ_RECORD=1 records the cassette from a real run, the credential in s.Secret; otherwise the cassette replays.
func Run(t *testing.T, s Subject) {
	record := os.Getenv("HZ_RECORD") != ""
	var tape *Cassette
	if record {
		if s.Secret == "" {
			t.Fatal("HZ_RECORD needs the provider's credential")
		}
		tape = &Cassette{Record: true, Secrets: []string{s.Secret}}
	} else {
		var err error
		if tape, err = Load(s.Cassette); err != nil {
			t.Fatalf("%v: record it with HZ_RECORD=1", err)
		}
	}
	var log []event
	tape.Served = func(i Interaction) { log = append(log, event{req: &i}) }
	say := func(f string, a ...any) { log = append(log, event{say: fmt.Sprintf(f, a...)}) }
	sleep := func(ctx context.Context, d time.Duration) error { return nil }
	if record {
		sleep = cloud.Wait
	}
	cl := s.New(tape, say, sleep)
	c := naming.Cluster{Name: cluster}
	ctx := context.Background()
	if record {
		// Recording starts and ends with nothing of the cluster's, whatever happens between.
		direct := s.New(http.DefaultTransport, func(string, ...any) {}, cloud.Wait)
		if err := direct.Destroy(ctx, c); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := direct.Destroy(ctx, c); err != nil {
				t.Errorf("cleanup: %v", err)
			}
			if !t.Failed() {
				if err := tape.Save(s.Cassette); err != nil {
					t.Error(err)
				}
			}
		})
	}
	mark := 0
	since := func() []Interaction {
		var out []Interaction
		for _, e := range log[mark:] {
			if e.req != nil {
				out = append(out, *e.req)
			}
		}
		mark = len(log)
		return out
	}
	writes := func(is []Interaction) []string {
		var out []string
		for _, i := range is {
			if op, _ := s.Classify(i.Method, i.Path); op != "" {
				out = append(out, i.Method+" "+i.Path)
			}
		}
		return out
	}
	must := func(what string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v (%v)", what, err, tape.Miss)
		}
	}

	must("base", cl.Base(ctx, c, s.Location, key, open))
	if len(writes(since())) == 0 {
		t.Fatal("the first base wrote nothing")
	}
	must("base again", cl.Base(ctx, c, s.Location, key, open))
	if w := writes(since()); len(w) > 0 {
		t.Errorf("the second base writes %v", w)
	}

	control := cloud.Spec{Name: c.Control(), Type: s.Type, Location: s.Location, PrivateIP: naming.ControlIP}
	made, err := cl.Server(ctx, c, control)
	must("server", err)
	if made.ID == "" || made.Name != control.Name || made.PublicIP == "" {
		t.Errorf("server returns %+v", made)
	}
	since()
	again, err := cl.Server(ctx, c, control)
	must("server again", err)
	if w := writes(since()); len(w) > 0 || again != made {
		t.Errorf("the second server writes %v and returns %+v, not %+v", w, again, made)
	}
	found, err := cl.Lookup(ctx, control.Name)
	must("lookup", err)
	if found != made {
		t.Errorf("lookup returns %+v, server %+v", found, made)
	}
	if _, err := cl.Lookup(ctx, c.Prefix()+"-nobody"); err == nil || !strings.Contains(err.Error(), c.Prefix()+"-nobody") {
		t.Errorf("lookup of an unknown server: %v", err)
	}
	if id := cl.ProviderID(made); !strings.Contains(id, made.ID) {
		t.Errorf("provider id %q does not hold the server's id %s", id, made.ID)
	}

	worker := cloud.Spec{Name: c.Prefix() + "-w1", Type: s.Type, Location: s.Location, PrivateIP: "10.0.1.3", Init: cloudInit}
	w1, err := cl.Server(ctx, c, worker)
	must("worker", err)
	list, err := cl.List(ctx, c)
	must("list", err)
	if !slices.Contains(list, made) || !slices.Contains(list, w1) || len(list) != 2 {
		t.Errorf("list is %+v, not the two servers", list)
	}
	since()

	bad := cloud.Spec{Name: c.Prefix() + "-bad", Type: "nope", Location: s.Location, PrivateIP: "10.0.1.4"}
	_, err = cl.Server(ctx, c, bad)
	var refused *Interaction
	for _, i := range since() {
		if i.Status >= 400 && i.Status < 500 {
			refused = &i
		}
	}
	switch {
	case refused == nil:
		t.Errorf("a server of type nope met no 4xx (%v)", err)
	case s.Message([]byte(refused.Response)) == "":
		t.Errorf("no message read from %s", refused.Response)
	case err == nil || !strings.Contains(err.Error(), s.Message([]byte(refused.Response))):
		t.Errorf("the error %q does not carry the provider's %q", err, s.Message([]byte(refused.Response)))
	}

	must("delete", cl.Delete(ctx, worker.Name))
	if len(writes(since())) == 0 {
		t.Error("delete wrote nothing")
	}
	must("delete again", cl.Delete(ctx, worker.Name))
	must("delete an unknown server", cl.Delete(ctx, c.Prefix()+"-nobody"))
	if w := writes(since()); len(w) > 0 {
		t.Errorf("deleting what is gone writes %v", w)
	}

	must("destroy", cl.Destroy(ctx, c))
	list, err = cl.List(ctx, c)
	must("list after destroy", err)
	if len(list) > 0 {
		t.Errorf("destroy leaves %+v", list)
	}
	since()
	quiet := len(log)
	must("destroy again", cl.Destroy(ctx, c))
	for _, e := range log[quiet:] {
		if e.say != "" {
			t.Errorf("the second destroy says %q", e.say)
		}
	}
	if w := writes(since()); len(w) > 0 {
		t.Errorf("the second destroy writes %v", w)
	}

	if tape.Miss != nil {
		t.Error(tape.Miss)
	}
	if n := tape.Left(); n > 0 {
		t.Errorf("%d recorded requests were not made", n)
	}
	check(t, s, c, log)
}

// What holds over the whole run: marks, announcements, ports, and teardown order.
func check(t *testing.T, s Subject, c naming.Cluster, log []event) {
	said, rules := false, 0
	created, deleted := map[string]string{}, map[string]bool{}
	lastServer, firstOther := -1, -1
	for n, e := range log {
		if e.say != "" {
			said = true
			continue
		}
		i := *e.req
		op, kind := s.Classify(i.Method, i.Path)
		if ports, ok, err := s.Ports(i.Method, i.Path, []byte(i.Body)); err != nil {
			t.Errorf("%s %s: %v", i.Method, i.Path, err)
		} else if ok {
			rules++
			if !slices.Equal(ports, cloud.Inbound(open)) {
				t.Errorf("%s %s opens %v, not %v", i.Method, i.Path, ports, cloud.Inbound(open))
			}
		}
		if i.Status >= 300 || (op != "create" && op != "delete") {
			continue
		}
		if !said {
			t.Errorf("%s %s is not announced", i.Method, i.Path)
		}
		said = false
		switch op {
		case "create":
			if _, ok := s.Unmarked[kind]; !ok && !marked(i.Body, c) {
				t.Errorf("%s %s carries no %s: %s", i.Method, i.Path, cloud.OwnerSelector(c), i.Body)
			}
			created[s.Created([]byte(i.Response))] = kind
		case "delete":
			deleted[s.Deleted(i.Path)] = true
			if kind == "servers" {
				lastServer = n
			} else if firstOther < 0 {
				firstOther = n
			}
		}
	}
	if rules == 0 {
		t.Error("no request wrote the firewall's rules")
	}
	for id, kind := range created {
		if !deleted[id] {
			t.Errorf("%s %s is created and never deleted", kind, id)
		}
	}
	if firstOther >= 0 && firstOther < lastServer {
		t.Error("a network, firewall or key is deleted before the last server")
	}
}

// Whether a JSON body holds hz/owner=<prefix>, as a key and value or as one string.
func marked(body string, c naming.Cluster) bool {
	var v any
	if json.Unmarshal([]byte(body), &v) != nil {
		return false
	}
	var walk func(any) bool
	walk = func(v any) bool {
		switch v := v.(type) {
		case map[string]any:
			if v[cloud.OwnerKey] == c.Prefix() {
				return true
			}
			for _, x := range v {
				if walk(x) {
					return true
				}
			}
		case []any:
			return slices.ContainsFunc(v, walk)
		case string:
			return v == c.Owner()
		}
		return false
	}
	return walk(v)
}
