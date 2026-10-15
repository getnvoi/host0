package main

import (
	"io"
	"net/http"
	"os"
	"testing"
)

// H0_RECORD=1 with HCLOUD_TOKEN set writes Hetzner's real answers, which the offer's tests serve, to testdata.
func TestRecordHetzner(t *testing.T) {
	if os.Getenv("H0_RECORD") != "1" {
		t.Skip("H0_RECORD=1 records")
	}
	for path, file := range map[string]string{"/server_types?per_page=50": "hetzner-server_types.json", "/locations": "hetzner-locations.json"} {
		req, _ := http.NewRequest("GET", "https://api.hetzner.cloud/v1"+path, nil)
		req.Header.Set("Authorization", "Bearer "+os.Getenv("HCLOUD_TOKEN"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil || res.StatusCode != 200 {
			t.Fatalf("%s: %d %v %s", path, res.StatusCode, err, b)
		}
		if err := os.WriteFile("testdata/"+file, b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
