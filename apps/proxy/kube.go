package main

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
	"strings"
	"time"
)

const sa = "/var/run/secrets/kubernetes.io/serviceaccount/"

// The one Secret the proxy's service account may get and update; the install creates it.
type kubeSecret struct {
	namespace, name, url string
	http                 *http.Client
}

func inCluster(namespace, name string) (*kubeSecret, error) {
	ca, err := os.ReadFile(sa + "ca.crt")
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(ca)
	return &kubeSecret{namespace: namespace, name: name,
		url:  fmt.Sprintf("https://kubernetes.default.svc/api/v1/namespaces/%s/secrets/%s", namespace, name),
		http: &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}},
	}, nil
}

type secretObject struct {
	APIVersion string            `json:"apiVersion"`
	Kind       string            `json:"kind"`
	Metadata   map[string]any    `json:"metadata"`
	Data       map[string][]byte `json:"data"`
}

func (k *kubeSecret) do(ctx context.Context, method string, body any) (*http.Response, []byte, error) {
	var in io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		in = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, k.url, in)
	if err != nil {
		return nil, nil, err
	}
	token, err := os.ReadFile(sa + "token")
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	req.Header.Set("Content-Type", "application/json")
	res, err := k.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	return res, raw, err
}

func (k *kubeSecret) get(ctx context.Context) (map[string][]byte, string, error) {
	res, raw, err := k.do(ctx, http.MethodGet, nil)
	if err != nil {
		return nil, "", err
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("GET %s: %s: %s", k.url, res.Status, raw)
	}
	var s secretObject
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, "", fmt.Errorf("GET %s: %w", k.url, err)
	}
	version, _ := s.Metadata["resourceVersion"].(string)
	return s.Data, version, nil
}

func (k *kubeSecret) put(ctx context.Context, data map[string][]byte, version string) error {
	body := secretObject{APIVersion: "v1", Kind: "Secret", Data: data, Metadata: map[string]any{
		"name": k.name, "namespace": k.namespace, "resourceVersion": version}}
	res, raw, err := k.do(ctx, http.MethodPut, body)
	if err != nil {
		return err
	}
	switch res.StatusCode {
	case http.StatusOK, http.StatusCreated:
		return nil
	case http.StatusConflict:
		return errConflict
	}
	return fmt.Errorf("PUT %s: %s: %s", k.url, res.Status, raw)
}
