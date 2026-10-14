package dns

import (
	"testing"

	"github.com/DNSControl/dnscontrol/v5/models"
)

func TestCarried(t *testing.T) {
	for in, want := range map[string]string{"false": "off", "true": "on", "full": "full"} {
		r := &models.RecordConfig{Metadata: map[string]string{"cloudflare_proxy": in}}
		if got := carried(r).Metadata["cloudflare_proxy"]; got != want {
			t.Errorf("%s: got %s, want %s", in, got, want)
		}
		if r.Metadata["cloudflare_proxy"] != in {
			t.Errorf("%s: the record read back was changed", in)
		}
	}
	r := &models.RecordConfig{}
	if carried(r) != r {
		t.Error("a record without the flag is carried as is")
	}
}
