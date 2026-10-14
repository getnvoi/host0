package workers

import "github.com/getnvoi/host0/internal/kube"

// The cluster as asked of Kubernetes, Substrate and the edge at the moment of the request.
type Cluster struct {
	Name    string      `json:"name"`
	Zone    string      `json:"zone"`
	Nodes   []kube.Node `json:"nodes"`
	Pools   []Pool      `json:"pools"`
	Workers []Worker    `json:"workers"`
	Edge    []Host      `json:"edge"`
}

type Pool struct {
	Name     string `json:"name"`
	Replicas int    `json:"replicas"`
	Ready    int    `json:"ready"`
}

type Worker struct {
	Pool     string   `json:"pool"`
	Pod      string   `json:"pod"`
	Assigned bool     `json:"assigned"`
	Actors   []string `json:"actors,omitempty"`
}

// A host the plane serves; Error says why its record does not point at the cluster's tunnel.
type Host struct {
	Name  string `json:"name"`
	Error string `json:"error,omitempty"`
}
