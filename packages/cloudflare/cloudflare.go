// Cloudflare: the cluster's tunnel and its ingress, found by name. Preview records belong to the plane.
package cloudflare

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

const api = "https://api.cloudflare.com/client/v4"

type Client struct {
	Token  string
	Zone   string
	Suffix string // preview hosts are <name>-<cluster><Suffix>; that route is claimed with no Worker, so nothing on the zone intercepts them
	Say    func(string, ...any)
}

// Scoped to the cluster, so a broader route on the zone (another app's *-preview Worker) keeps the rest.
func (c Client) pattern(cl naming.Cluster) string {
	return "*-" + cl.Name + c.Suffix + "." + c.Zone + "/*"
}

// The zone and its account. A zone moved to another account keeps answering to its name with status
// "moved"; only the one in service counts.
func (c Client) zone(ctx context.Context) (id, account string, err error) {
	var zones []struct {
		ID, Status string
		Account    struct{ ID string } `json:"account"`
	}
	if err := c.do(ctx, "GET", "/zones?name="+url.QueryEscape(c.Zone), nil, &zones); err != nil {
		return "", "", fmt.Errorf("zone %s: %w", c.Zone, err)
	}
	for _, z := range zones {
		if z.Status == "active" || z.Status == "pending" || z.Status == "initializing" {
			return z.ID, z.Account.ID, nil
		}
	}
	return "", "", fmt.Errorf("cloudflare: the token does not reach zone %s in service", c.Zone)
}

func (c Client) zoneID(ctx context.Context) (string, error) {
	id, _, err := c.zone(ctx)
	return id, err
}

type route struct {
	ID, Pattern, Script string
}

func (c Client) routes(ctx context.Context, zone string) ([]route, error) {
	var rs []route
	err := c.do(ctx, "GET", "/zones/"+zone+"/workers/routes", nil, &rs)
	return rs, err
}

func (c Client) claim(ctx context.Context, cl naming.Cluster) error {
	zone, err := c.zoneID(ctx)
	if err != nil {
		return err
	}
	rs, err := c.routes(ctx, zone)
	if err != nil {
		return err
	}
	for _, r := range rs {
		if r.Pattern == c.pattern(cl) {
			if r.Script != "" {
				return fmt.Errorf("route %s belongs to worker %s", r.Pattern, r.Script)
			}
			return nil
		}
	}
	c.Say("route %s, no worker", c.pattern(cl))
	return c.do(ctx, "POST", "/zones/"+zone+"/workers/routes", map[string]string{"pattern": c.pattern(cl)}, nil)
}

var _ infra.Edge = Client{}

func (c Client) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, api+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var env struct {
		Success bool            `json:"success"`
		Errors  json.RawMessage `json:"errors"`
		Result  json.RawMessage `json:"result"`
	}
	raw, _ := io.ReadAll(res.Body)
	if err := json.Unmarshal(raw, &env); err != nil || !env.Success {
		return fmt.Errorf("cloudflare %s %s: %d %s", method, path, res.StatusCode, env.Errors)
	}
	if out != nil {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

func (c Client) account(ctx context.Context) (string, error) {
	_, acc, err := c.zone(ctx)
	return acc, err
}

func (c Client) find(ctx context.Context, acc, name string) (string, error) {
	var ts []struct{ ID string }
	q := "?is_deleted=false&name=" + url.QueryEscape(name)
	if err := c.do(ctx, "GET", "/accounts/"+acc+"/cfd_tunnel"+q, nil, &ts); err != nil || len(ts) == 0 {
		return "", err
	}
	return ts[0].ID, nil
}

func (c Client) Tunnel(ctx context.Context, cl naming.Cluster, service string) (string, error) {
	acc, err := c.account(ctx)
	if err != nil {
		return "", err
	}
	id, err := c.find(ctx, acc, cl.Tunnel())
	if err != nil {
		return "", err
	}
	if id == "" {
		c.Say("tunnel %s", cl.Tunnel())
		var t struct{ ID string }
		if err := c.do(ctx, "POST", "/accounts/"+acc+"/cfd_tunnel",
			map[string]any{"name": cl.Tunnel(), "config_src": "cloudflare"}, &t); err != nil {
			return "", err
		}
		id = t.ID
	}
	if err := c.claim(ctx, cl); err != nil {
		return "", err
	}
	// Every request on this tunnel goes to the plane, which reads the host.
	ingress := map[string]any{"config": map[string]any{"ingress": []map[string]any{{"service": service}}}}
	if err := c.do(ctx, "PUT", "/accounts/"+acc+"/cfd_tunnel/"+id+"/configurations", ingress, nil); err != nil {
		return "", err
	}
	var token string
	err = c.do(ctx, "GET", "/accounts/"+acc+"/cfd_tunnel/"+id+"/token", nil, &token)
	return token, err
}

// The tunnel and every record pointing at it.
func (c Client) Destroy(ctx context.Context, cl naming.Cluster) error {
	acc, err := c.account(ctx)
	if err != nil {
		return err
	}
	id, err := c.find(ctx, acc, cl.Tunnel())
	if err != nil || id == "" {
		return err
	}
	zone, err := c.zoneID(ctx)
	if err != nil {
		return err
	}
	if rs, err := c.routes(ctx, zone); err == nil {
		for _, r := range rs {
			if r.Pattern == c.pattern(cl) && r.Script == "" {
				c.Say("delete route %s", r.Pattern)
				if err := c.do(ctx, "DELETE", "/zones/"+zone+"/workers/routes/"+r.ID, nil, nil); err != nil {
					return err
				}
			}
		}
	}
	var records []struct{ ID, Name string }
	target := id + ".cfargotunnel.com"
	if err := c.do(ctx, "GET", "/zones/"+zone+"/dns_records?per_page=5000&content="+target, nil, &records); err != nil {
		return err
	}
	for _, r := range records {
		c.Say("delete record %s", r.Name)
		if err := c.do(ctx, "DELETE", "/zones/"+zone+"/dns_records/"+r.ID, nil, nil); err != nil {
			return err
		}
	}
	c.Say("delete tunnel %s", cl.Tunnel())
	if err := c.do(ctx, "DELETE", "/accounts/"+acc+"/cfd_tunnel/"+id+"/connections", nil, nil); err != nil {
		return err
	}
	// Cloudflare takes a while to notice connectors that are gone, and refuses the delete until it has.
	for deadline := time.Now().Add(5 * time.Minute); ; time.Sleep(10 * time.Second) {
		err := c.do(ctx, "DELETE", "/accounts/"+acc+"/cfd_tunnel/"+id, nil, nil)
		if err == nil || !strings.Contains(err.Error(), "active connections") || time.Now().After(deadline) {
			return err
		}
	}
}
