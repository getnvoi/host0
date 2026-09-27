// Hetzner Cloud by name and label: every call looks before it creates, nothing is stored.
package hetzner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/getnvoi/host0/infra"
	"github.com/getnvoi/host0/shared/naming"
)

const api = "https://api.hetzner.cloud/v1"

type Client struct {
	Token string
	Say   func(string, ...any)
}

var _ infra.Cloud = Client{}

func (h Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, api+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+h.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var e struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return fmt.Errorf("hetzner %s %s: %d %s %s", method, path, res.StatusCode, e.Error.Code, e.Error.Message)
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
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
	err := json.Unmarshal(got[kind], &items)
	return items, err
}

// One item by name, or zero.
func (h Client) find(ctx context.Context, kind, name string) (int64, error) {
	items, err := h.list(ctx, kind, "name="+url.QueryEscape(name))
	if err != nil || len(items) == 0 {
		return 0, err
	}
	return items[0].ID, nil
}

func (h Client) ensure(ctx context.Context, kind, name string, body map[string]any) error {
	id, err := h.find(ctx, kind, name)
	if err != nil || id != 0 {
		return err
	}
	h.Say("%s %s", strings.TrimSuffix(kind, "s"), name)
	return h.do(ctx, "POST", "/"+kind, body, nil)
}

func (h Client) Base(ctx context.Context, c naming.Cluster, location, publicKey string) error {
	labels := c.Labels()
	if err := h.ensure(ctx, "networks", c.Prefix(), map[string]any{
		"name": c.Prefix(), "ip_range": naming.NetRange, "labels": labels,
		"subnets": []map[string]any{{"type": "cloud", "ip_range": naming.Subnet, "network_zone": zone(location)}},
	}); err != nil {
		return err
	}
	if err := h.ensure(ctx, "firewalls", c.Prefix(), map[string]any{
		"name": c.Prefix(), "labels": labels,
		"rules": []map[string]any{{"direction": "in", "protocol": "tcp", "port": "22",
			"source_ips": []string{"0.0.0.0/0", "::/0"}}},
	}); err != nil {
		return err
	}
	return h.ensure(ctx, "ssh_keys", c.Prefix(), map[string]any{
		"name": c.Prefix(), "public_key": publicKey, "labels": labels,
	})
}

type server struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	PublicNet struct {
		IPv4 struct{ IP string } `json:"ipv4"`
	} `json:"public_net"`
}

func (h Client) Server(ctx context.Context, c naming.Cluster, name, serverType, location, privateIP string) (infra.Server, error) {
	id, err := h.find(ctx, "servers", name)
	if err != nil {
		return infra.Server{}, err
	}
	if id == 0 {
		net, err := h.find(ctx, "networks", c.Prefix())
		if err != nil {
			return infra.Server{}, err
		}
		fw, err := h.find(ctx, "firewalls", c.Prefix())
		if err != nil {
			return infra.Server{}, err
		}
		h.Say("server %s (%s, %s)", name, serverType, location)
		var made struct{ Server server }
		if err := h.do(ctx, "POST", "/servers", map[string]any{
			"name": name, "server_type": serverType, "location": location, "image": "ubuntu-24.04",
			"ssh_keys": []string{c.Prefix()}, "labels": c.Labels(),
			"firewalls": []map[string]any{{"firewall": fw}},
		}, &made); err != nil {
			return infra.Server{}, err
		}
		id = made.Server.ID
		path := fmt.Sprintf("/servers/%d/actions/attach_to_network", id)
		if err := h.action(ctx, path, map[string]any{"network": net, "ip": privateIP}); err != nil {
			return infra.Server{}, err
		}
	}
	for deadline := time.Now().Add(5 * time.Minute); time.Now().Before(deadline); time.Sleep(3 * time.Second) {
		var got struct{ Server server }
		if err := h.do(ctx, "GET", fmt.Sprintf("/servers/%d", id), nil, &got); err != nil {
			return infra.Server{}, err
		}
		if got.Server.Status == "running" {
			return infra.Server{ID: id, Name: name, PublicIP: got.Server.PublicNet.IPv4.IP}, nil
		}
	}
	return infra.Server{}, fmt.Errorf("server %s not running after 5m", name)
}

// Retries while the server is locked by its own create.
func (h Client) action(ctx context.Context, path string, body any) error {
	for i := 0; ; i++ {
		var got struct {
			Action struct {
				ID int64 `json:"id"`
			} `json:"action"`
		}
		err := h.do(ctx, "POST", path, body, &got)
		if err != nil && strings.Contains(err.Error(), "locked") && i < 40 {
			time.Sleep(3 * time.Second)
			continue
		}
		if err != nil {
			return err
		}
		for {
			var a struct {
				Action struct{ Status string } `json:"action"`
			}
			if err := h.do(ctx, "GET", fmt.Sprintf("/actions/%d", got.Action.ID), nil, &a); err != nil {
				return err
			}
			switch a.Action.Status {
			case "success":
				return nil
			case "error":
				return fmt.Errorf("hetzner %s failed", path)
			}
			time.Sleep(2 * time.Second)
		}
	}
}

// Servers first, the autoscaler's included: a network or firewall in use cannot go.
func (h Client) Destroy(ctx context.Context, c naming.Cluster) error {
	sel := "label_selector=" + url.QueryEscape(c.Selector())
	servers, err := h.list(ctx, "servers", sel)
	if err != nil {
		return err
	}
	for _, s := range servers {
		h.Say("delete server %s", s.Name)
		if err := h.do(ctx, "DELETE", fmt.Sprintf("/servers/%d", s.ID), nil, nil); err != nil {
			return err
		}
	}
	for _, kind := range []string{"firewalls", "ssh_keys", "networks"} {
		items, err := h.list(ctx, kind, sel)
		if err != nil {
			return err
		}
		for _, it := range items {
			h.Say("delete %s %s", strings.TrimSuffix(kind, "s"), it.Name)
			for i := 0; ; i++ {
				err := h.do(ctx, "DELETE", fmt.Sprintf("/%s/%d", kind, it.ID), nil, nil)
				if err == nil {
					break
				}
				if i == 40 || !strings.Contains(err.Error(), "in use") && !strings.Contains(err.Error(), "resource_in_use") {
					return err
				}
				time.Sleep(3 * time.Second)
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
