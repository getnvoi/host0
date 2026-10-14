package scaleway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/shared/naming"
)

// A VPC and its private network in the region, a security group in the zone and the project's ssh key, each named
// Prefix. The VPC keeps two clusters of one project from sharing a subnet.
func (s Client) Base(ctx context.Context, c naming.Cluster, publicKey string, open []int) error {
	name := c.Prefix()
	vpc, err := s.find(ctx, s.vpcs(), "vpcs", name)
	if err != nil {
		return err
	}
	if vpc == "" {
		s.say("vpc %s (%s)", name, s.region)
		var made named
		if err := s.do(ctx, "POST", s.vpcs(), map[string]any{"name": name, "project_id": s.project, "tags": owner(c)}, &made); err != nil {
			return err
		}
		vpc = made.ID
	}
	pn, err := s.find(ctx, s.networks(), "private_networks", name)
	if err != nil {
		return err
	}
	if pn == "" {
		s.say("private network %s %s", name, naming.Subnet)
		if err := s.do(ctx, "POST", s.networks(), map[string]any{"name": name, "project_id": s.project, "vpc_id": vpc,
			"subnets": []string{naming.Subnet}, "tags": owner(c)}, nil); err != nil {
			return err
		}
	}
	if err := s.group(ctx, c, open); err != nil {
		return err
	}
	return s.key(ctx, name, publicKey)
}

type rule struct {
	Protocol  string `json:"protocol"`
	Direction string `json:"direction"`
	Action    string `json:"action"`
	IPRange   string `json:"ip_range"`
	From      *int   `json:"dest_port_from"`
	To        *int   `json:"dest_port_to"`
	Position  int    `json:"position,omitempty"`
	Editable  bool   `json:"editable"`
}

// tcp Inbound(open) from anywhere, IPv4 and IPv6.
func rules(open []int) []rule {
	var rs []rule
	for _, p := range cloud.Inbound(open) {
		for _, from := range []string{"0.0.0.0/0", "::/0"} {
			rs = append(rs, rule{Protocol: "TCP", Direction: "inbound", Action: "accept", IPRange: from,
				From: &p, Position: len(rs) + 1, Editable: true})
		}
	}
	return rs
}

// The editable rules as comparable lines, sorted; the project's fixed SMTP drops are not ours. A single port reads
// the same with or without dest_port_to.
func lines(rs []rule) []string {
	var out []string
	for _, r := range rs {
		if !r.Editable {
			continue
		}
		from, to := "*", "*"
		if r.From != nil {
			from = fmt.Sprint(*r.From)
			to = from
		}
		if r.To != nil {
			to = fmt.Sprint(*r.To)
		}
		out = append(out, strings.Join([]string{r.Direction, r.Action, r.Protocol, r.IPRange, from, to}, " "))
	}
	slices.Sort(out)
	return out
}

// The tcp ports a rules body opens; a rule that is not one inbound tcp port is an error.
func Ports(body []byte) ([]int, error) {
	var b struct{ Rules []rule }
	if err := json.Unmarshal(body, &b); err != nil {
		return nil, err
	}
	var ports []int
	for _, r := range b.Rules {
		if r.Direction != "inbound" || r.Protocol != "TCP" || r.Action != "accept" || r.From == nil ||
			r.To != nil && *r.To != *r.From {
			return nil, fmt.Errorf("rule %+v is not one tcp port in", r)
		}
		ports = append(ports, *r.From)
	}
	return slices.Compact(slices.Sorted(slices.Values(ports))), nil
}

// The security group named Prefix: stateful, inbound dropped but for rules(open), outbound accepted. It filters the
// public interface only. Its rules are replaced in one call when they differ.
func (s Client) group(ctx context.Context, c naming.Cluster, open []int) error {
	name, want := c.Prefix(), rules(open)
	id, err := s.find(ctx, s.groups(), "security_groups", name)
	if err != nil {
		return err
	}
	if id == "" {
		s.say("security group %s (%s)", name, s.zone)
		var made struct {
			SecurityGroup named `json:"security_group"`
		}
		if err := s.do(ctx, "POST", s.groups(), map[string]any{"name": name, "project": s.project,
			"tags": owner(c), "stateful": true, "inbound_default_policy": "drop",
			"outbound_default_policy": "accept", "enable_default_security": true}, &made); err != nil {
			return err
		}
		id = made.SecurityGroup.ID
	} else {
		var got []rule
		if err := s.items(ctx, s.groups()+"/"+id+"/rules?per_page=100", "rules", &got); err != nil {
			return err
		}
		if slices.Equal(lines(got), lines(want)) {
			return nil
		}
	}
	s.say("security group %s: tcp %v", name, cloud.Inbound(open))
	return s.do(ctx, "PUT", s.groups()+"/"+id+"/rules", map[string]any{"rules": want}, nil)
}

// IAM keys take no tags: ours is the one named Prefix. The same key under another name already reaches every
// server of the project, so it is left as it is.
func (s Client) key(ctx context.Context, name, publicKey string) error {
	var got []struct {
		named
		PublicKey string `json:"public_key"`
	}
	q := url.Values{"project_id": {s.project}, "page_size": {"100"}}
	if err := s.items(ctx, keys+"?"+q.Encode(), "ssh_keys", &got); err != nil {
		return err
	}
	for _, k := range got {
		if k.Name == name {
			return nil
		}
		if same(k.PublicKey, publicKey) {
			s.say("ssh key already in the project as %s", k.Name)
			return nil
		}
	}
	s.say("ssh key %s", name)
	return s.do(ctx, "POST", keys, map[string]any{"name": name, "public_key": publicKey, "project_id": s.project}, nil)
}

// Two authorized_keys lines hold the same key whatever their comments.
func same(a, b string) bool {
	fa, fb := strings.Fields(a), strings.Fields(b)
	return len(fa) >= 2 && len(fb) >= 2 && fa[0] == fb[0] && fa[1] == fb[1]
}
