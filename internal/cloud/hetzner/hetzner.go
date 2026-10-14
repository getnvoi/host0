// Hetzner Cloud by name and owner label: every call looks before it creates, nothing is stored.
package hetzner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/shared/naming"
)

var Provider = cloud.Provider{
	Name:  "hetzner",
	Creds: []cloud.Credential{{Key: "token", Var: "HCLOUD_TOKEN", Help: "a Hetzner Cloud project's read and write API token"}},
	// ccx23 for both: a new project allows 8 dedicated cores, which is one control node and one worker.
	Defaults: cloud.Defaults{Location: "fsn1", ControlType: "ccx23", WorkerType: "ccx23", Arch: "amd64"},
	New: func(creds map[string]string, location string, say func(string, ...any)) (cloud.Cloud, error) {
		if creds["token"] == "" {
			return nil, fmt.Errorf("hetzner needs its token")
		}
		if location == "" {
			return nil, fmt.Errorf("hetzner needs a location: fsn1, nbg1, hel1, ash, hil, sin")
		}
		return New(creds["token"], location, http.DefaultTransport, say, cloud.Wait), nil
	},
}

// The cluster's private network; servers attach in naming.Subnet.
const netRange = "10.0.0.0/16"

type Client struct {
	location string
	rest     cloud.REST
	say      func(string, ...any)
	sleep    cloud.Sleep
}

var _ cloud.Cloud = Client{}

func New(token, location string, rt http.RoundTripper, say func(string, ...any), sleep cloud.Sleep) Client {
	return Client{location: location, say: say, sleep: sleep, rest: cloud.REST{
		Provider:  "hetzner",
		Base:      "https://api.hetzner.cloud/v1",
		Auth:      func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) },
		Transport: rt,
		Message:   Message,
	}}
}

// The sentence in a Hetzner error body, with its code.
func Message(body []byte) string {
	var e struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if json.Unmarshal(body, &e) != nil || e.Error.Message == "" {
		return ""
	}
	return e.Error.Message + " (" + e.Error.Code + ")"
}

func (Client) Name() string { return "hetzner" }

func (h Client) do(ctx context.Context, method, path string, in, out any) error {
	return h.rest.Do(ctx, method, path, in, out)
}

type item struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// The items of a collection answering the query.
func (h Client) list(ctx context.Context, kind, query string) ([]item, error) {
	var got map[string]json.RawMessage
	if err := h.do(ctx, "GET", "/"+kind+"?"+query, nil, &got); err != nil {
		return nil, err
	}
	var items []item
	if err := json.Unmarshal(got[kind], &items); err != nil {
		return nil, fmt.Errorf("hetzner %s: %w", kind, err)
	}
	return items, nil
}

// One item by exact name, or zero.
func (h Client) find(ctx context.Context, kind, name string) (int64, error) {
	items, err := h.list(ctx, kind, "name="+url.QueryEscape(name))
	if err != nil {
		return 0, err
	}
	it, _ := cloud.Exact(items, func(i item) string { return i.Name }, name)
	return it.ID, nil
}

func (h Client) ensure(ctx context.Context, kind, name string, body map[string]any) error {
	id, err := h.find(ctx, kind, name)
	if err != nil || id != 0 {
		return err
	}
	h.say("%s %s", strings.TrimSuffix(kind, "s"), name)
	return h.do(ctx, "POST", "/"+kind, body, nil)
}

func (h Client) Base(ctx context.Context, c naming.Cluster, publicKey string, open []int) error {
	if err := h.ensure(ctx, "networks", c.Prefix(), map[string]any{
		"name": c.Prefix(), "ip_range": netRange, "labels": cloud.Owner(c),
		"subnets": []map[string]any{{"type": "cloud", "ip_range": naming.Subnet, "network_zone": zone(h.location)}},
	}); err != nil {
		return err
	}
	if err := h.firewall(ctx, c, open); err != nil {
		return err
	}
	return h.ensure(ctx, "ssh_keys", c.Prefix(), map[string]any{
		"name": c.Prefix(), "public_key": publicKey, "labels": cloud.Owner(c),
	})
}

type server struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	PublicNet struct {
		IPv4 *struct{ IP string } `json:"ipv4"`
		// A /64; the server answers on its first address.
		IPv6 *struct{ IP string } `json:"ipv6"`
	} `json:"public_net"`
}

func (s server) public() cloud.Server {
	out := cloud.Server{ID: strconv.FormatInt(s.ID, 10), Name: s.Name}
	if s.PublicNet.IPv4 != nil {
		out.PublicIP = s.PublicNet.IPv4.IP
	}
	if s.PublicNet.IPv6 != nil {
		if p, err := netip.ParsePrefix(s.PublicNet.IPv6.IP); err == nil {
			out.PublicIPv6 = p.Masked().Addr().Next().String()
		}
	}
	return out
}

func (h Client) servers(ctx context.Context, query string) ([]server, error) {
	var got struct{ Servers []server }
	if err := h.do(ctx, "GET", "/servers?"+query, nil, &got); err != nil {
		return nil, err
	}
	return got.Servers, nil
}

func (h Client) byName(ctx context.Context, name string) (server, bool, error) {
	ss, err := h.servers(ctx, "name="+url.QueryEscape(name))
	if err != nil {
		return server{}, false, err
	}
	s, ok := cloud.Exact(ss, func(s server) string { return s.Name }, name)
	return s, ok, nil
}

func (h Client) Lookup(ctx context.Context, name string) (cloud.Server, error) {
	s, ok, err := h.byName(ctx, name)
	if err != nil {
		return cloud.Server{}, err
	}
	if !ok {
		return cloud.Server{}, fmt.Errorf("hetzner: no server %s", name)
	}
	return s.public(), nil
}

func (h Client) List(ctx context.Context, c naming.Cluster) ([]cloud.Server, error) {
	ss, err := h.servers(ctx, "label_selector="+url.QueryEscape(cloud.OwnerSelector(c)))
	if err != nil {
		return nil, err
	}
	out := []cloud.Server{}
	for _, s := range ss {
		out = append(out, s.public())
	}
	return out, nil
}

func (Client) ProviderID(s cloud.Server) string { return "hcloud://" + s.ID }

const metadata = "http://169.254.169.254/hetzner/v1/metadata"

// The metadata service has the id and the IPv4; the IPv6 is the first global address cloud-init configured.
func (Client) Identity() string {
	return `id=$(curl -sf --retry 10 --retry-all-errors ` + metadata + `/instance-id)
v4=$(curl -sf --retry 10 --retry-all-errors ` + metadata + `/public-ipv4)
v6=$(ip -6 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)
provider_id="hcloud://$id"
external_ips="$v4${v6:+,$v6}"
`
}

func (h Client) Server(ctx context.Context, c naming.Cluster, spec cloud.Spec) (cloud.Server, error) {
	s, ok, err := h.byName(ctx, spec.Name)
	if err != nil {
		return cloud.Server{}, err
	}
	id := s.ID
	if !ok {
		net, err := h.find(ctx, "networks", c.Prefix())
		if err != nil {
			return cloud.Server{}, err
		}
		fw, err := h.find(ctx, "firewalls", c.Prefix())
		if err != nil {
			return cloud.Server{}, err
		}
		if net == 0 || fw == 0 {
			return cloud.Server{}, fmt.Errorf("hetzner: no network or firewall %s: the cluster's base comes first", c.Prefix())
		}
		h.say("server %s (%s, %s)", spec.Name, spec.Type, h.location)
		body := map[string]any{
			"name": spec.Name, "server_type": spec.Type, "location": h.location, "image": "ubuntu-24.04",
			"ssh_keys": []string{c.Prefix()}, "labels": cloud.Owner(c),
			"firewalls": []map[string]any{{"firewall": fw}},
		}
		if spec.Init != "" {
			body["user_data"] = spec.Init
		}
		var made struct{ Server server }
		if err := h.do(ctx, "POST", "/servers", body, &made); err != nil {
			return cloud.Server{}, err
		}
		id = made.Server.ID
		path := fmt.Sprintf("/servers/%d/actions/attach_to_network", id)
		if err := h.action(ctx, "POST", path, map[string]any{"network": net, "ip": spec.PrivateIP}); err != nil {
			return cloud.Server{}, err
		}
	}
	for range 100 {
		var got struct{ Server server }
		if err := h.do(ctx, "GET", fmt.Sprintf("/servers/%d", id), nil, &got); err != nil {
			return cloud.Server{}, err
		}
		if got.Server.Status == "running" {
			return got.Server.public(), nil
		}
		if err := h.sleep(ctx, 3*time.Second); err != nil {
			return cloud.Server{}, err
		}
	}
	return cloud.Server{}, fmt.Errorf("hetzner: server %s not running after 5m", spec.Name)
}

// A server, network or firewall another action holds, or one still in use by what is going.
func busy(e *cloud.Error) bool {
	return strings.Contains(e.Message, "(locked)") || strings.Contains(e.Message, "(resource_in_use)") ||
		strings.Contains(e.Message, "(conflict)")
}

// Runs an action and waits for it to end; retried while what it acts on is busy.
func (h Client) action(ctx context.Context, method, path string, body any) error {
	var got struct {
		Action struct {
			ID int64 `json:"id"`
		} `json:"action"`
	}
	if err := cloud.Retry(ctx, 40, 3*time.Second, h.sleep, busy, func() error {
		return h.do(ctx, method, path, body, &got)
	}); err != nil {
		return err
	}
	for range 150 {
		var a struct {
			Action struct {
				Status string
				Error  *struct{ Code, Message string }
			} `json:"action"`
		}
		if err := h.do(ctx, "GET", fmt.Sprintf("/actions/%d", got.Action.ID), nil, &a); err != nil {
			return err
		}
		switch a.Action.Status {
		case "success":
			return nil
		case "error":
			msg := "no reason given"
			if a.Action.Error != nil {
				msg = a.Action.Error.Message + " (" + a.Action.Error.Code + ")"
			}
			return fmt.Errorf("hetzner %s %s: %s", method, path, msg)
		}
		if err := h.sleep(ctx, 2*time.Second); err != nil {
			return err
		}
	}
	return fmt.Errorf("hetzner %s %s: action %d not done after 5m", method, path, got.Action.ID)
}

func (h Client) Delete(ctx context.Context, name string) error {
	s, ok, err := h.byName(ctx, name)
	if err != nil || !ok {
		return err
	}
	h.say("delete server %s", s.Name)
	return h.action(ctx, "DELETE", fmt.Sprintf("/servers/%d", s.ID), nil)
}

// Servers first, the plane's workers included: a network or firewall in use cannot go.
func (h Client) Destroy(ctx context.Context, c naming.Cluster) error {
	sel := "label_selector=" + url.QueryEscape(cloud.OwnerSelector(c))
	servers, err := h.servers(ctx, sel)
	if err != nil {
		return err
	}
	for _, s := range servers {
		h.say("delete server %s", s.Name)
		if err := h.action(ctx, "DELETE", fmt.Sprintf("/servers/%d", s.ID), nil); err != nil {
			return err
		}
	}
	for _, kind := range []string{"firewalls", "ssh_keys", "networks"} {
		items, err := h.list(ctx, kind, sel)
		if err != nil {
			return err
		}
		for _, it := range items {
			h.say("delete %s %s", strings.TrimSuffix(kind, "s"), it.Name)
			if err := cloud.Retry(ctx, 40, 3*time.Second, h.sleep, busy, func() error {
				return h.do(ctx, "DELETE", fmt.Sprintf("/%s/%d", kind, it.ID), nil, nil)
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func zone(location string) string {
	switch location {
	case "ash":
		return "us-east"
	case "hil":
		return "us-west"
	case "sin":
		return "ap-southeast"
	}
	return "eu-central"
}
