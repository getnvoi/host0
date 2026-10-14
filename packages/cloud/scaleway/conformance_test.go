package scaleway

import (
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/cloud/conformance"
)

func TestConformance(t *testing.T) {
	secret, project := os.Getenv("SCW_SECRET_KEY"), os.Getenv("SCW_DEFAULT_PROJECT_ID")
	if os.Getenv("HZ_RECORD") == "" {
		project = "REDACTED"
	}
	conformance.Run(t, conformance.Subject{
		New: func(rt http.RoundTripper, location string, say func(string, ...any), sleep cloud.Sleep) cloud.Cloud {
			return New(secret, project, location, rt, say, sleep)
		},
		Cassette: "testdata/scaleway.json",
		Secrets:  []string{secret, project},
		Cluster:  "scwconf",
		Location: "fr-par-2",
		Type:     "POP2-4C-16G",
		Classify: classify,
		Created:  created,
		Deleted: func(path string) string {
			parts := strings.Split(strings.TrimSuffix(path, "/action"), "/")
			return parts[len(parts)-1]
		},
		Ports: func(method, path string, body []byte) ([]int, bool, error) {
			if method != "PUT" || !strings.HasSuffix(path, "/rules") {
				return nil, false, nil
			}
			ports, err := Ports(body)
			return ports, true, err
		},
		Unmarked: map[string]string{"ssh-keys": "IAM keys take no tags; ours is the one named Prefix"},
		Message:  Message,
	})
}

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// A POST to a collection creates, but a server's private NIC is a write on the server; terminate deletes a server.
func classify(method, path string, body []byte) (op, kind string) {
	parts := strings.Split(path, "/")
	last := parts[len(parts)-1]
	switch {
	case method == "GET":
		return "", last
	case method == "DELETE":
		return "delete", parts[len(parts)-2]
	case method == "POST" && last == "action":
		if strings.Contains(string(body), `"terminate"`) {
			return "delete", "servers"
		}
		return "write", "servers"
	case method == "POST" && last == "private_nics":
		return "write", "servers"
	case method == "POST" && !uuid.MatchString(last):
		return "create", last
	}
	return "write", parts[len(parts)-2]
}

// The id of what a create answered: at the top, or under its one key.
func created(response []byte) string {
	var top struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(response, &top) == nil && top.ID != "" {
		return top.ID
	}
	var wrapped map[string]struct {
		ID string `json:"id"`
	}
	json.Unmarshal(response, &wrapped)
	for _, v := range wrapped {
		if v.ID != "" {
			return v.ID
		}
	}
	return ""
}

func TestPorts(t *testing.T) {
	body, _ := json.Marshal(map[string]any{"rules": rules([]int{443, 80, 443})})
	got, err := Ports(body)
	if err != nil || !slices.Equal(got, []int{22, 80, 443}) {
		t.Errorf("ports %v %v", got, err)
	}
}
