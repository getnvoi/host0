// Scaleway by name and owner tag: every call looks before it creates, nothing is stored.
package scaleway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/shared/naming"
)

var Provider = cloud.Provider{
	Name: "scaleway",
	Creds: []cloud.Credential{
		{Key: "secret_key", Var: "SCW_SECRET_KEY", Help: "a Scaleway API key's secret, allowed to manage the project"},
		{Key: "project_id", Var: "SCW_DEFAULT_PROJECT_ID", Help: "the Scaleway project the cluster lives in"},
	},
	Defaults: cloud.Defaults{Location: "fr-par-2", ControlType: "POP2-4C-16G", WorkerType: "POP2-4C-16G", Arch: "amd64"},
	New: func(creds map[string]string, location string, say func(string, ...any)) (cloud.Cloud, error) {
		if creds["secret_key"] == "" || creds["project_id"] == "" {
			return nil, fmt.Errorf("scaleway needs its secret_key and project_id")
		}
		if strings.Count(location, "-") != 2 {
			return nil, fmt.Errorf("scaleway needs a zone for its location, such as fr-par-2, nl-ams-1, pl-waw-1: got %q", location)
		}
		return New(creds["secret_key"], creds["project_id"], location, http.DefaultTransport, say, cloud.Wait), nil
	},
}

// The client acts in one zone; its private network and IPAM are the zone's region's.
type Client struct {
	project, zone, region string
	rest                  cloud.REST
	say                   func(string, ...any)
	sleep                 cloud.Sleep
}

var _ cloud.Cloud = Client{}

func New(secret, project, zone string, rt http.RoundTripper, say func(string, ...any), sleep cloud.Sleep) Client {
	return Client{project: project, zone: zone, region: zone[:strings.LastIndex(zone, "-")], say: say, sleep: sleep,
		rest: cloud.REST{
			Provider:  "scaleway",
			Base:      "https://api.scaleway.com",
			Auth:      func(r *http.Request) { r.Header.Set("X-Auth-Token", secret) },
			Transport: rt,
			Message:   Message,
		}}
}

func (Client) Name() string { return "scaleway" }

// Server.ID is "<zone>/<uuid>", as Scaleway's cloud controller writes the node's providerID.
func (Client) ProviderID(s cloud.Server) string { return "scaleway://instance/" + s.ID }

// The metadata service answers its JSON to a client bound to a port under 1024.
const metadata = "http://169.254.42.42/conf?format=json"

// The id, zone and public addresses from the metadata service; an address of each family, IPv4 first.
func (Client) Identity() string {
	return `meta=$(curl -sSf --local-port 1-1023 --retry 10 --retry-all-errors '` + metadata + `')
eval "$(printf '%s' "$meta" | python3 -c '
import json, sys
m = json.load(sys.stdin)
ips = {ip["family"]: ip["address"] for ip in m.get("public_ips") or []}
print("provider_id=scaleway://instance/%s/%s" % (m["zone"], m["id"]))
print("external_ips=" + ",".join(ips[f] for f in ("inet", "inet6") if f in ips))
')"
`
}

// Scaleway's sentence for an error body: its message, the help and the fields it names, and its type.
func Message(body []byte) string {
	var e struct {
		Message, Type string
		Help          string `json:"help_message"`
		Fields        map[string][]string
		Details       []struct {
			ArgumentName string `json:"argument_name"`
			Reason       string
			HelpMessage  string `json:"help_message"`
		}
	}
	if json.Unmarshal(body, &e) != nil || e.Message == "" {
		return ""
	}
	parts := []string{e.Message}
	if e.Help != "" {
		parts = append(parts, e.Help)
	}
	for _, d := range e.Details {
		why := d.HelpMessage
		if why == "" {
			why = d.Reason
		}
		parts = append(parts, d.ArgumentName+": "+why)
	}
	keys := make([]string, 0, len(e.Fields))
	for k := range e.Fields {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		parts = append(parts, k+": "+strings.Join(e.Fields[k], ", "))
	}
	msg := strings.Join(parts, "; ")
	if e.Type != "" {
		msg += " (" + e.Type + ")"
	}
	return msg
}

func (s Client) do(ctx context.Context, method, path string, in, out any) error {
	return s.rest.Do(ctx, method, path, in, out)
}

func status(err error) int {
	var e *cloud.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

// A resource still attached or still changing state answers 409 or 412.
func busy(e *cloud.Error) bool { return e.Status == 409 || e.Status == 412 }

func (s Client) retry(ctx context.Context, f func() error) error {
	return cloud.Retry(ctx, 40, 3*time.Second, s.sleep, busy, f)
}

// Each address, volume and private address a server holds carries its name too, so its Delete finds them.
func of(name string) string { return "hz/server=" + name }

type named struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// The items under key of a GET; more than one page is an error.
func (s Client) items(ctx context.Context, path, key string, out any) error {
	var got map[string]json.RawMessage
	if err := s.do(ctx, "GET", path, nil, &got); err != nil {
		return err
	}
	raw, ok := got[key]
	if !ok {
		return fmt.Errorf("scaleway GET %s: no %q in the answer", path, key)
	}
	var all []json.RawMessage
	if err := json.Unmarshal(raw, &all); err != nil {
		return fmt.Errorf("scaleway GET %s: %w", path, err)
	}
	var total int
	if t, ok := got["total_count"]; ok && json.Unmarshal(t, &total) == nil && total > len(all) {
		return fmt.Errorf("scaleway GET %s: %d of %d %s, more than one page", path, len(all), total, key)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("scaleway GET %s: %w", path, err)
	}
	return nil
}

// The id of what is named name exactly under path, or ""; the API's name filter matches substrings.
func (s Client) find(ctx context.Context, path, key, name string) (string, error) {
	var got []named
	q := url.Values{"name": {name}}
	if strings.HasPrefix(path, "/instance/") {
		q.Set("project", s.project)
		q.Set("per_page", "100")
	} else {
		q.Set("project_id", s.project)
		q.Set("page_size", "100")
	}
	if err := s.items(ctx, path+"?"+q.Encode(), key, &got); err != nil {
		return "", err
	}
	it, _ := cloud.Exact(got, func(n named) string { return n.Name }, name)
	return it.ID, nil
}

func (s Client) vpcs() string      { return "/vpc/v2/regions/" + s.region + "/vpcs" }
func (s Client) networks() string  { return "/vpc/v2/regions/" + s.region + "/private-networks" }
func (s Client) addresses() string { return "/ipam/v1/regions/" + s.region + "/ips" }
func (s Client) instance() string  { return "/instance/v1/zones/" + s.zone }
func (s Client) groups() string    { return s.instance() + "/security_groups" }
func (s Client) volumes() string   { return "/block/v1alpha1/zones/" + s.zone + "/volumes" }

const keys = "/iam/v1alpha1/ssh-keys"

func owner(c naming.Cluster) []string { return []string{c.Owner()} }
