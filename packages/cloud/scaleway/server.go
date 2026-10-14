package scaleway

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"time"

	"github.com/getnvoi/host0/cloud"
	"github.com/getnvoi/host0/shared/naming"
)

const (
	label = "ubuntu_noble"
	// Bytes, the root volume.
	rootSize = 80_000_000_000
)

type server struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	State       string   `json:"state"`
	Zone        string   `json:"zone"`
	PublicIPs   []public `json:"public_ips"`
	PrivateNics []named  `json:"private_nics"`
	Volumes     map[string]struct {
		ID         string `json:"id"`
		VolumeType string `json:"volume_type"`
	} `json:"volumes"`
}

type public struct {
	ID      string `json:"id"`
	Address string `json:"address"`
	Family  string `json:"family"`
}

// A routed IPv6 is a /64 on the address object; the server's entry holds its own SLAAC address in it.
func (s server) public() cloud.Server {
	out := cloud.Server{ID: s.Zone + "/" + s.ID, Name: s.Name}
	for _, ip := range s.PublicIPs {
		switch ip.Family {
		case "inet":
			out.PublicIP = ip.Address
		case "inet6":
			out.PublicIPv6 = ip.Address
		}
	}
	return out
}

func (s server) has(family string) bool {
	return slices.ContainsFunc(s.PublicIPs, func(ip public) bool { return ip.Family == family })
}

func (s Client) servers(ctx context.Context, q url.Values) ([]server, error) {
	q.Set("project", s.project)
	q.Set("per_page", "100")
	var got []server
	if err := s.items(ctx, s.instance()+"/servers?"+q.Encode(), "servers", &got); err != nil {
		return nil, err
	}
	return got, nil
}

func (s Client) byName(ctx context.Context, name string) (server, bool, error) {
	all, err := s.servers(ctx, url.Values{"name": {name}})
	if err != nil {
		return server{}, false, err
	}
	sv, ok := cloud.Exact(all, func(sv server) string { return sv.Name }, name)
	return sv, ok, nil
}

func (s Client) Lookup(ctx context.Context, name string) (cloud.Server, error) {
	sv, ok, err := s.byName(ctx, name)
	if err != nil {
		return cloud.Server{}, err
	}
	if !ok {
		return cloud.Server{}, fmt.Errorf("scaleway: no server %s in %s", name, s.zone)
	}
	return sv.public(), nil
}

func (s Client) List(ctx context.Context, c naming.Cluster) ([]cloud.Server, error) {
	all, err := s.servers(ctx, url.Values{"tags": {c.Owner()}})
	if err != nil {
		return nil, err
	}
	out := []cloud.Server{}
	for _, sv := range all {
		out = append(out, sv.public())
	}
	return out, nil
}

// Ubuntu 24.04 on a block volume for commercial type kind. When no image lists kind, the first is returned and the
// server create says what is wrong with kind.
func (s Client) image(ctx context.Context, kind string) (string, error) {
	q := url.Values{"image_label": {label}, "zone": {s.zone}, "type": {"instance_sbs"}, "page_size": {"100"}}
	var got []struct {
		ID         string   `json:"id"`
		Compatible []string `json:"compatible_commercial_types"`
	}
	if err := s.items(ctx, "/marketplace/v2/local-images?"+q.Encode(), "local_images", &got); err != nil {
		return "", err
	}
	if len(got) == 0 {
		return "", fmt.Errorf("scaleway: no %s image in %s", label, s.zone)
	}
	for _, im := range got {
		if slices.Contains(im.Compatible, kind) {
			return im.ID, nil
		}
	}
	return got[0].ID, nil
}

// An existing running server is returned as it is. A stopped one is finished: addresses, private NIC, user data,
// volume tags, then started.
func (s Client) Server(ctx context.Context, c naming.Cluster, spec cloud.Spec) (cloud.Server, error) {
	sv, ok, err := s.byName(ctx, spec.Name)
	if err != nil {
		return cloud.Server{}, err
	}
	if !ok {
		group, err := s.find(ctx, s.groups(), "security_groups", c.Prefix())
		if err != nil {
			return cloud.Server{}, err
		}
		if group == "" {
			return cloud.Server{}, fmt.Errorf("scaleway: no security group %s in %s: the cluster's base comes first", c.Prefix(), s.zone)
		}
		im, err := s.image(ctx, spec.Type)
		if err != nil {
			return cloud.Server{}, err
		}
		s.say("server %s (%s, %s)", spec.Name, spec.Type, s.zone)
		var made struct{ Server server }
		if err := s.do(ctx, "POST", s.instance()+"/servers", map[string]any{
			"name": spec.Name, "commercial_type": spec.Type, "image": im, "project": s.project,
			"tags": owner(c), "security_group": group, "dynamic_ip_required": false,
			"volumes": map[string]any{"0": map[string]any{"size": rootSize, "volume_type": "sbs_volume"}},
		}, &made); err != nil {
			return cloud.Server{}, err
		}
		sv = made.Server
	}
	if sv.State == "stopped" {
		if err := s.finish(ctx, c, spec, sv); err != nil {
			return cloud.Server{}, err
		}
	}
	for range 100 {
		if sv.State == "running" {
			return sv.public(), nil
		}
		if err := s.sleep(ctx, 3*time.Second); err != nil {
			return cloud.Server{}, err
		}
		var got struct{ Server server }
		if err := s.do(ctx, "GET", s.instance()+"/servers/"+sv.ID, nil, &got); err != nil {
			return cloud.Server{}, err
		}
		sv = got.Server
	}
	return cloud.Server{}, fmt.Errorf("scaleway: server %s is %s after 5m, not running", spec.Name, sv.State)
}

func (s Client) finish(ctx context.Context, c naming.Cluster, spec cloud.Spec, sv server) error {
	tags := []string{c.Owner(), of(spec.Name)}
	for _, f := range []struct{ family, kind string }{{"inet", "routed_ipv4"}, {"inet6", "routed_ipv6"}} {
		if sv.has(f.family) {
			continue
		}
		id, err := s.address(ctx, spec.Name, f.kind, tags)
		if err != nil {
			return err
		}
		if err := s.do(ctx, "PATCH", s.instance()+"/ips/"+id, map[string]any{"server": sv.ID}, nil); err != nil {
			return err
		}
	}
	if len(sv.PrivateNics) == 0 {
		pn, err := s.find(ctx, s.networks(), "private_networks", c.Prefix())
		if err != nil {
			return err
		}
		if pn == "" {
			return fmt.Errorf("scaleway: no private network %s in %s: the cluster's base comes first", c.Prefix(), s.region)
		}
		id, err := s.reserve(ctx, pn, spec, tags)
		if err != nil {
			return err
		}
		s.say("private nic %s %s", spec.Name, spec.PrivateIP)
		if err := s.do(ctx, "POST", s.instance()+"/servers/"+sv.ID+"/private_nics",
			map[string]any{"private_network_id": pn, "tags": tags, "ipam_ip_ids": []string{id}}, nil); err != nil {
			return err
		}
	}
	if spec.Init != "" {
		if err := s.do(ctx, "PATCH", s.instance()+"/servers/"+sv.ID+"/user_data/cloud-init", cloud.Text(spec.Init), nil); err != nil {
			return err
		}
	}
	for _, v := range sv.Volumes {
		if v.VolumeType != "sbs_volume" {
			continue
		}
		if err := s.do(ctx, "PATCH", s.volumes()+"/"+v.ID, map[string]any{"name": spec.Name, "tags": tags}, nil); err != nil {
			return err
		}
	}
	s.say("start server %s", spec.Name)
	return s.retry(ctx, func() error {
		return s.do(ctx, "POST", s.instance()+"/servers/"+sv.ID+"/action", map[string]any{"action": "poweron"}, nil)
	})
}

type ip struct {
	ID      string   `json:"id"`
	Address string   `json:"address"`
	Prefix  string   `json:"prefix"`
	Type    string   `json:"type"`
	Server  *named   `json:"server"`
	Tags    []string `json:"tags"`
}

// A detached routed address of kind tagged for the server, or a new one.
func (s Client) address(ctx context.Context, name, kind string, tags []string) (string, error) {
	var got []ip
	q := url.Values{"project": {s.project}, "tags": {of(name)}, "per_page": {"100"}}
	if err := s.items(ctx, s.instance()+"/ips?"+q.Encode(), "ips", &got); err != nil {
		return "", err
	}
	for _, a := range got {
		if a.Type == kind && a.Server == nil {
			return a.ID, nil
		}
	}
	s.say("%s for %s", kind, name)
	var made struct{ IP ip }
	if err := s.do(ctx, "POST", s.instance()+"/ips", map[string]any{"project": s.project, "type": kind, "tags": tags}, &made); err != nil {
		return "", err
	}
	return made.IP.ID, nil
}

// spec.PrivateIP booked in IPAM on the private network, or the booking already tagged for the server. DHCP on the
// NIC hands out the booked address.
func (s Client) reserve(ctx context.Context, pn string, spec cloud.Spec, tags []string) (string, error) {
	var got []named
	q := url.Values{"project_id": {s.project}, "tags": {of(spec.Name)}, "private_network_id": {pn}, "page_size": {"100"}}
	if err := s.items(ctx, s.addresses()+"?"+q.Encode(), "ips", &got); err != nil {
		return "", err
	}
	if len(got) > 0 {
		return got[0].ID, nil
	}
	s.say("private address %s for %s", spec.PrivateIP, spec.Name)
	var made named
	if err := s.do(ctx, "POST", s.addresses(), map[string]any{"project_id": s.project, "address": spec.PrivateIP,
		"source": map[string]any{"private_network_id": pn}, "tags": tags}, &made); err != nil {
		return "", err
	}
	return made.ID, nil
}

// The server, then its addresses, private address and volume, found by its name tag.
func (s Client) Delete(ctx context.Context, name string) error {
	sv, ok, err := s.byName(ctx, name)
	if err != nil || !ok {
		return err
	}
	return s.remove(ctx, sv)
}

// terminate leaves the block volume and the addresses, which go by their tag once the server is gone.
func (s Client) remove(ctx context.Context, sv server) error {
	s.say("delete server %s", sv.Name)
	path := s.instance() + "/servers/" + sv.ID
	if err := s.retry(ctx, func() error {
		return s.do(ctx, "POST", path+"/action", map[string]any{"action": "terminate"}, nil)
	}); err != nil {
		return err
	}
	gone := false
	for range 100 {
		err := s.do(ctx, "GET", path, nil, nil)
		if status(err) == 404 {
			gone = true
			break
		}
		if err != nil {
			return err
		}
		if err := s.sleep(ctx, 3*time.Second); err != nil {
			return err
		}
	}
	if !gone {
		return fmt.Errorf("scaleway: server %s still there 5m after terminate", sv.Name)
	}
	return s.sweep(ctx, of(sv.Name))
}

// Addresses, volumes and IPAM bookings tagged tag.
func (s Client) sweep(ctx context.Context, tag string) error {
	var ips []ip
	q := url.Values{"project": {s.project}, "tags": {tag}, "per_page": {"100"}}
	if err := s.items(ctx, s.instance()+"/ips?"+q.Encode(), "ips", &ips); err != nil {
		return err
	}
	for _, a := range ips {
		if slices.Contains(a.Tags, tag) {
			if err := s.remove1(ctx, "ip "+a.Address+a.Prefix, s.instance()+"/ips/"+a.ID); err != nil {
				return err
			}
		}
	}
	var vols []struct {
		named
		Tags []string `json:"tags"`
	}
	q = url.Values{"project_id": {s.project}, "page_size": {"100"}}
	if err := s.items(ctx, s.volumes()+"?"+q.Encode(), "volumes", &vols); err != nil {
		return err
	}
	for _, v := range vols {
		if slices.Contains(v.Tags, tag) {
			if err := s.remove1(ctx, "volume "+v.Name, s.volumes()+"/"+v.ID); err != nil {
				return err
			}
		}
	}
	var booked []struct {
		ID      string   `json:"id"`
		Address string   `json:"address"`
		Tags    []string `json:"tags"`
	}
	q = url.Values{"project_id": {s.project}, "tags": {tag}, "page_size": {"100"}}
	if err := s.items(ctx, s.addresses()+"?"+q.Encode(), "ips", &booked); err != nil {
		return err
	}
	for _, a := range booked {
		if slices.Contains(a.Tags, tag) {
			if err := s.remove1(ctx, "private address "+a.Address, s.addresses()+"/"+a.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s Client) remove1(ctx context.Context, what, path string) error {
	s.say("delete %s", what)
	return s.retry(ctx, func() error { return s.do(ctx, "DELETE", path, nil, nil) })
}

// Servers first, the plane's workers included, then what they held, the security group, the private network, the
// VPC and the ssh key.
func (s Client) Destroy(ctx context.Context, c naming.Cluster) error {
	all, err := s.servers(ctx, url.Values{"tags": {c.Owner()}})
	if err != nil {
		return err
	}
	for _, sv := range all {
		if err := s.remove(ctx, sv); err != nil {
			return err
		}
	}
	if err := s.sweep(ctx, c.Owner()); err != nil {
		return err
	}
	name := c.Prefix()
	for _, d := range []struct{ what, path, key string }{
		{"security group", s.groups(), "security_groups"},
		{"private network", s.networks(), "private_networks"},
		{"vpc", s.vpcs(), "vpcs"},
		{"ssh key", keys, "ssh_keys"},
	} {
		id, err := s.find(ctx, d.path, d.key, name)
		if err != nil {
			return err
		}
		if id != "" {
			if err := s.remove1(ctx, d.what+" "+name, d.path+"/"+id); err != nil {
				return err
			}
		}
	}
	return nil
}
