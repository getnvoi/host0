package hetzner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strconv"

	"github.com/getnvoi/host0/internal/cloud"
	"github.com/getnvoi/host0/internal/shared/naming"
)

type rule struct {
	Direction string   `json:"direction"`
	Protocol  string   `json:"protocol"`
	Port      string   `json:"port"`
	SourceIPs []string `json:"source_ips"`
}

// tcp Inbound(open), from anywhere.
func rules(open []int) []rule {
	var rs []rule
	for _, p := range cloud.Inbound(open) {
		rs = append(rs, rule{"in", "tcp", strconv.Itoa(p), []string{"0.0.0.0/0", "::/0"}})
	}
	return rs
}

// The rules as comparable lines, in order.
func lines(rs []rule) []string {
	var out []string
	for _, r := range rs {
		out = append(out, r.Direction+" "+r.Protocol+" "+r.Port+" "+fmt.Sprint(r.SourceIPs))
	}
	slices.Sort(out)
	return out
}

// The tcp ports a firewall create or set_rules body opens; conformance reads the rule writes with it.
func Ports(body []byte) ([]int, error) {
	var b struct{ Rules []rule }
	if err := json.Unmarshal(body, &b); err != nil {
		return nil, err
	}
	var ports []int
	for _, r := range b.Rules {
		p, err := strconv.Atoi(r.Port)
		if err != nil || r.Direction != "in" || r.Protocol != "tcp" {
			return nil, fmt.Errorf("rule %+v is not one tcp port in", r)
		}
		ports = append(ports, p)
	}
	slices.Sort(ports)
	return ports, nil
}

type firewall struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Rules []rule `json:"rules"`
}

// The firewall named Cluster.Prefix() with exactly rules(open): made when absent, its rules set when they differ.
func (h Client) firewall(ctx context.Context, c naming.Cluster, open []int) error {
	want := rules(open)
	var got struct {
		Firewalls []firewall `json:"firewalls"`
	}
	if err := h.do(ctx, "GET", "/firewalls?name="+url.QueryEscape(c.Prefix()), nil, &got); err != nil {
		return err
	}
	fw, ok := cloud.Exact(got.Firewalls, func(f firewall) string { return f.Name }, c.Prefix())
	if !ok {
		h.say("firewall %s", c.Prefix())
		return h.do(ctx, "POST", "/firewalls", map[string]any{"name": c.Prefix(), "labels": cloud.Owner(c), "rules": want}, nil)
	}
	if slices.Equal(lines(fw.Rules), lines(want)) {
		return nil
	}
	h.say("firewall %s: %v", c.Prefix(), lines(want))
	return h.do(ctx, "POST", fmt.Sprintf("/firewalls/%d/actions/set_rules", fw.ID), map[string]any{"rules": want}, nil)
}
