// controlplane.Pools on the cluster's own API, with the plane's service account.
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
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/getnvoi/host0/controlplane"
)

const sa = "/var/run/secrets/kubernetes.io/serviceaccount/"

type Client struct {
	Namespace string
	http      *http.Client
}

var _ controlplane.Pools = (*Client)(nil)

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

func (c *Client) Hold(ctx context.Context, node string, on bool) error {
	var v any
	if on {
		v = "true"
	}
	return c.do(ctx, "PATCH", "/api/v1/nodes/"+node, map[string]any{"metadata": map[string]any{"annotations": map[string]any{
		"cluster-autoscaler.kubernetes.io/scale-down-disabled": v}}}, nil)
}

// The ReplicaSet removes the lowest cost first; a free worker goes before any that holds an actor.
func (c *Client) Cost(ctx context.Context, pod string, cost int) error {
	return c.do(ctx, "PATCH", fmt.Sprintf("/api/v1/namespaces/%s/pods/%s", c.Namespace, pod),
		map[string]any{"metadata": map[string]any{"annotations": map[string]string{
			"controller.kubernetes.io/pod-deletion-cost": strconv.Itoa(cost)}}}, nil)
}
