// edge.Router on Router: a proxied CNAME per host, to the tunnel the connector's token names.
package cloudflare

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/getnvoi/host0/internal/edge"
)

type Router struct {
	Token, Zone, TunnelToken string
}

var _ edge.Router = Router{}

var client = &http.Client{Timeout: 30 * time.Second}

func (c Router) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, "https://api.cloudflare.com/client/v4"+path, body)
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var env struct {
		Success bool            `json:"success"`
		Errors  json.RawMessage `json:"errors"`
		Result  json.RawMessage `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil || !env.Success {
		return fmt.Errorf("cloudflare %s %s: %d %s", method, path, res.StatusCode, env.Errors)
	}
	if out != nil {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

func (c Router) tunnel() (string, error) {
	raw, err := base64.StdEncoding.DecodeString(c.TunnelToken)
	if err != nil {
		return "", err
	}
	var t struct {
		T string `json:"t"`
	}
	return t.T, json.Unmarshal(raw, &t)
}

// The zone's id, the tunnel's target and the records on host.
func (c Router) lookup(ctx context.Context, host string) (string, string, []record, error) {
	tunnel, err := c.tunnel()
	if err != nil {
		return "", "", nil, fmt.Errorf("tunnel token: %w", err)
	}
	// A zone moved to another account still answers to its name, with status "moved".
	var zones []struct{ ID, Status string }
	if err := c.do(ctx, "GET", "/zones?name="+url.QueryEscape(c.Zone), nil, &zones); err != nil {
		return "", "", nil, fmt.Errorf("zone %s: %w", c.Zone, err)
	}
	z := ""
	for _, zone := range zones {
		if zone.Status == "active" || zone.Status == "pending" || zone.Status == "initializing" {
			z = zone.ID
			break
		}
	}
	if z == "" {
		return "", "", nil, fmt.Errorf("zone %s: not reachable in service", c.Zone)
	}
	var records []record
	if err := c.do(ctx, "GET", "/zones/"+z+"/dns_records?name="+url.QueryEscape(host), nil, &records); err != nil {
		return "", "", nil, err
	}
	return z, tunnel + ".cfargotunnel.com", records, nil
}

type record struct{ ID, Type, Content string }

func (c Router) Route(ctx context.Context, host string) error {
	z, target, records, err := c.lookup(ctx, host)
	if err != nil {
		return err
	}
	for _, r := range records {
		// Only a record already pointing here is ours to keep; anything else on the name belongs to someone else.
		if r.Type != "CNAME" || r.Content != target {
			return fmt.Errorf("%s is taken: %s %s", host, r.Type, r.Content)
		}
		return nil
	}
	rec := map[string]any{"type": "CNAME", "name": host, "content": target, "proxied": true, "ttl": 1, "comment": "h0"}
	return c.do(ctx, "POST", "/zones/"+z+"/dns_records", rec, nil)
}

func (c Router) Check(ctx context.Context, host string) error {
	_, target, records, err := c.lookup(ctx, host)
	if err != nil {
		return err
	}
	for _, r := range records {
		if r.Type != "CNAME" || r.Content != target {
			return fmt.Errorf("%s is taken: %s %s", host, r.Type, r.Content)
		}
		return nil
	}
	return fmt.Errorf("%s has no record", host)
}
