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
