package hetzner

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/cloud/conformance"
)

func TestConformance(t *testing.T) {
	token := os.Getenv("HCLOUD_TOKEN")
	conformance.Run(t, conformance.Subject{
		New: func(rt http.RoundTripper, location string, say func(string, ...any), sleep cloud.Sleep) cloud.Cloud {
			return New(token, location, rt, say, sleep)
		},
		Cassette: "testdata/hetzner.json",
		Secrets:  []string{token},
		Cluster:  "conf",
		Location: "fsn1",
		Type:     "ccx13",
		Classify: classify,
		Created: func(response []byte) string {
			// {"server": {...}, "action": {...}}: the one that is not an action.
			var r map[string]json.RawMessage
			json.Unmarshal(response, &r)
			for k, raw := range r {
				var v struct {
					ID json.Number `json:"id"`
				}
				if k != "action" && json.Unmarshal(raw, &v) == nil && v.ID != "" {
					return v.ID.String()
				}
			}
			return ""
		},
		Deleted: func(path string) string { return path[strings.LastIndex(path, "/")+1:] },
		Ports: func(method, path string, body []byte) ([]int, bool, error) {
			if method != "POST" || path != "/v1/firewalls" && !strings.HasSuffix(path, "/actions/set_rules") {
				return nil, false, nil
			}
			ports, err := Ports(body)
			return ports, true, err
		},
		Message: Message,
	})
}

// POST to a collection creates, DELETE deletes, an action writes.
func classify(method, path string, _ []byte) (op, kind string) {
	parts := strings.Split(strings.TrimPrefix(path, "/v1/"), "/")
	kind = parts[0]
	switch {
	case method == "POST" && len(parts) == 1:
		return "create", kind
	case method == "DELETE":
		return "delete", kind
	case method != "GET":
		return "write", kind
	}
	return "", kind
}
