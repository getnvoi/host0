package naming

import "testing"

func TestOwns(t *testing.T) {
	c := Cluster{"dev"}
	for host, want := range map[string]bool{
		Host(c, "api", "nvoi.to"):      true,
		"4ca708e1-dev-preview.nvoi.to": true,
		"API-DEV.NVOI.TO.":             true,
		"dev.nvoi.to":                  false,
		"-dev.nvoi.to":                 false,
		"api-prod.nvoi.to":             false,
		"api-dev.other.to":             false,
		"a.api-dev.nvoi.to":            false,
		"_acme-challenge.nvoi.to":      false,
		"4ca708e1-dev-staging.nvoi.to": false,
		"api-dev.nvoi.to.evil.example": false,
	} {
		if got := Owns(c, "-preview", "nvoi.to", host); got != want {
			t.Errorf("Owns(%q) = %v, want %v", host, got, want)
		}
	}
}

func TestWorker(t *testing.T) {
	c := Cluster{Name: "edge"}
	if got := c.Worker(3); got != "h0-edge-w3" {
		t.Fatal(got)
	}
	for name, want := range map[string]int{"h0-edge-w3": 3, "h0-edge-w12": 12} {
		if n, ok := c.WorkerIndex(name); !ok || n != want {
			t.Errorf("%s: %d %t", name, n, ok)
		}
	}
	for _, name := range []string{"h0-edge-control", "h0-edge-w0", "h0-edge-w03", "h0-edge-wx", "h0-edgy-w1", "h0-edge-w-1"} {
		if _, ok := c.WorkerIndex(name); ok {
			t.Errorf("%s is taken for a worker", name)
		}
	}
	if WorkerIP(3) != "10.0.1.13" {
		t.Fatal(WorkerIP(3))
	}
}
