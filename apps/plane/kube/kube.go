// plane.Pools on the cluster's own API, with the plane's service account.
package kube

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/plane"
	"github.com/getnvoi/host0/shared/contract"
)

const sa = "/var/run/secrets/kubernetes.io/serviceaccount/"

type Client struct {
	Namespace string
	http      *http.Client
}

var _ plane.Pools = (*Client)(nil)

func InCluster(namespace string) (*Client, error) {
	ca, err := os.ReadFile(sa + "ca.crt")
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(ca)
	return &Client{Namespace: namespace, http: &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}}}, nil
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var in io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		in = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, "https://kubernetes.default.svc"+path, in)
	token, err := os.ReadFile(sa + "token")
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	req.Header.Set("Content-Type", "application/merge-patch+json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return fmt.Errorf("kube %s %s: %d %s", method, path, res.StatusCode, raw)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func (c *Client) pool(name string) string {
	return fmt.Sprintf("/apis/ate.dev/v1alpha1/namespaces/%s/workerpools/%s", c.Namespace, name)
}

func (c *Client) Replicas(ctx context.Context, pool string) (int, error) {
	var wp struct {
		Spec struct{ Replicas int } `json:"spec"`
	}
	err := c.do(ctx, "GET", c.pool(pool), nil, &wp)
	return wp.Spec.Replicas, err
}

func (c *Client) Ready(ctx context.Context, pool string) (int, error) {
	var wp struct {
		Status struct {
			ReadyReplicas int `json:"readyReplicas"`
		} `json:"status"`
	}
	err := c.do(ctx, "GET", c.pool(pool), nil, &wp)
	return wp.Status.ReadyReplicas, err
}

func (c *Client) Scale(ctx context.Context, pool string, replicas int) error {
	return c.do(ctx, "PATCH", c.pool(pool), map[string]any{"spec": map[string]int{"replicas": replicas}}, nil)
}

func (c *Client) Forget(ctx context.Context, node string) error {
	return c.do(ctx, "DELETE", "/api/v1/nodes/"+node, nil, nil)
}

func (c *Client) Cordon(ctx context.Context, node string, on bool) error {
	return c.do(ctx, "PATCH", "/api/v1/nodes/"+node, map[string]any{"spec": map[string]bool{"unschedulable": on}}, nil)
}

type pod struct {
	Metadata struct {
		Name              string  `json:"name"`
		DeletionTimestamp *string `json:"deletionTimestamp"`
	} `json:"metadata"`
	Status struct {
		Phase      string `json:"phase"`
		Conditions []struct {
			Type, Status, Reason string
		} `json:"conditions"`
	} `json:"status"`
}

func (c *Client) pods(ctx context.Context, selector string) ([]pod, error) {
	var list struct{ Items []pod }
	path := fmt.Sprintf("/api/v1/namespaces/%s/pods?fieldSelector=%s", c.Namespace, url.QueryEscape(selector))
	if err := c.do(ctx, "GET", path, nil, &list); err != nil {
		return nil, err
	}
	return list.Items, nil
}

func (c *Client) Unplaced(ctx context.Context) (int, error) {
	ps, err := c.pods(ctx, "status.phase=Pending")
	if err != nil {
		return 0, err
	}
	n := 0
	for _, p := range ps {
		for _, cond := range p.Status.Conditions {
			if cond.Type == "PodScheduled" && cond.Status == "False" && cond.Reason == "Unschedulable" {
				n++
			}
		}
	}
	return n, nil
}

func (c *Client) Occupants(ctx context.Context, node string) (int, error) {
	ps, err := c.pods(ctx, "spec.nodeName="+node)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, p := range ps {
		if p.Metadata.DeletionTimestamp == nil && p.Status.Phase != "Succeeded" && p.Status.Phase != "Failed" {
			n++
		}
	}
	return n, nil
}

func (c *Client) Nodes(ctx context.Context) ([]contract.Node, error) {
	var list struct {
		Items []struct {
			Metadata struct {
				Name              string            `json:"name"`
				Labels            map[string]string `json:"labels"`
				CreationTimestamp time.Time         `json:"creationTimestamp"`
			} `json:"metadata"`
			Spec struct {
				ProviderID string `json:"providerID"`
			} `json:"spec"`
			Status struct {
				Conditions []struct{ Type, Status string }  `json:"conditions"`
				Addresses  []struct{ Type, Address string } `json:"addresses"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := c.do(ctx, "GET", "/api/v1/nodes", nil, &list); err != nil {
		return nil, err
	}
	out := []contract.Node{}
	for _, it := range list.Items {
		n := contract.Node{Name: it.Metadata.Name, Roles: []string{}, Addresses: []string{}, ProviderID: it.Spec.ProviderID,
			Created: it.Metadata.CreationTimestamp}
		for _, a := range it.Status.Addresses {
			if a.Type == "ExternalIP" {
				n.Addresses = append(n.Addresses, a.Address)
			}
		}
		for l := range it.Metadata.Labels {
			if role, ok := strings.CutPrefix(l, "node-role.kubernetes.io/"); ok {
				n.Roles = append(n.Roles, role)
			}
		}
		sort.Strings(n.Roles)
		for _, cond := range it.Status.Conditions {
			if cond.Type == "Ready" {
				n.Ready = cond.Status == "True"
			}
		}
		out = append(out, n)
	}
	return out, nil
}

// The node's public addresses, which hz gave it at boot as node-external-ip.
func (c *Client) Addresses(ctx context.Context, node string) ([]string, error) {
	var n struct {
		Status struct {
			Addresses []struct{ Type, Address string } `json:"addresses"`
		} `json:"status"`
	}
	if err := c.do(ctx, "GET", "/api/v1/nodes/"+node, nil, &n); err != nil {
		return nil, err
	}
	var out []string
	for _, a := range n.Status.Addresses {
		if a.Type == "ExternalIP" {
			out = append(out, a.Address)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("node %s reports no ExternalIP", node)
	}
	return out, nil
}

// The ReplicaSet removes the lowest cost first; a free worker goes before any that holds an actor.
func (c *Client) Cost(ctx context.Context, pod string, cost int) error {
	return c.do(ctx, "PATCH", fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", c.Namespace, pod),
		map[string]any{"metadata": map[string]any{"annotations": map[string]string{
			"controller.kubernetes.io/pod-deletion-cost": strconv.Itoa(cost)}}}, nil)
}

// Every pod, or the node's when node is set.
func (c *Client) List(ctx context.Context, node string) ([]contract.Pod, error) {
	path := "/api/v1/pods"
	if node != "" {
		path += "?fieldSelector=" + url.QueryEscape("spec.nodeName="+node)
	}
	var list struct {
		Items []struct {
			Metadata struct{ Namespace, Name string } `json:"metadata"`
			Spec     struct {
				NodeName string `json:"nodeName"`
			} `json:"spec"`
			Status struct{ Phase string } `json:"status"`
		}
	}
	if err := c.do(ctx, "GET", path, nil, &list); err != nil {
		return nil, err
	}
	out := []contract.Pod{}
	for _, p := range list.Items {
		out = append(out, contract.Pod{Namespace: p.Metadata.Namespace, Name: p.Metadata.Name, Node: p.Spec.NodeName, Phase: p.Status.Phase})
	}
	return out, nil
}

func (c *Client) Log(ctx context.Context, namespace, pod, container string, tail int) (string, error) {
	q := url.Values{"tailLines": {strconv.Itoa(tail)}}
	if container != "" {
		q.Set("container", container)
	}
	req, _ := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("https://kubernetes.default.svc/api/v1/namespaces/%s/pods/%s/log?%s", url.PathEscape(namespace), url.PathEscape(pod), q.Encode()), nil)
	token, err := os.ReadFile(sa + "token")
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	res, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return "", err
	}
	if res.StatusCode >= 300 {
		return "", fmt.Errorf("kube log %s/%s: %d %s", namespace, pod, res.StatusCode, raw)
	}
	return string(raw), nil
}
