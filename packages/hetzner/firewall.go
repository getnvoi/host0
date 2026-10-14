package hetzner

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"strconv"

	"github.com/getnvoi/host0/shared/naming"
)

type rule struct {
	Direction string   `json:"direction"`
	Protocol  string   `json:"protocol"`
	Port      string   `json:"port"`
	SourceIPs []string `json:"source_ips"`
}

// tcp 22 and each of open, from anywhere.
func rules(open []int) []rule {
	ports := slices.Sorted(slices.Values(append([]int{22}, open...)))
	var rs []rule
	for _, p := range slices.Compact(ports) {
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

// The firewall named Cluster.Prefix() with exactly rules(open): made when absent, its rules set when they differ.
func (h Client) firewall(ctx context.Context, c naming.Cluster, open []int) error {
	want := rules(open)
	var got struct {
		Firewalls []struct {
			ID    int64  `json:"id"`
			Rules []rule `json:"rules"`
		} `json:"firewalls"`
	}
	if err := h.do(ctx, "GET", "/firewalls?name="+url.QueryEscape(c.Prefix()), nil, &got); err != nil {
		return err
	}
	if len(got.Firewalls) == 0 {
		h.Say("firewall %s", c.Prefix())
		return h.do(ctx, "POST", "/firewalls", map[string]any{"name": c.Prefix(), "labels": c.Labels(), "rules": want}, nil)
	}
	fw := got.Firewalls[0]
	if slices.Equal(lines(fw.Rules), lines(want)) {
		return nil
	}
	h.Say("firewall %s: %v", c.Prefix(), lines(want))
	return h.do(ctx, "POST", fmt.Sprintf("/firewalls/%d/actions/set_rules", fw.ID), map[string]any{"rules": want}, nil)
}
