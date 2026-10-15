package main

import (
	"bytes"
	"encoding/base64"
	"log"
	"strings"
	"testing"

	"github.com/getnvoi/host0/internal/shared/mask"
	"github.com/getnvoi/host0/internal/workspace"
)

const held = "sk_live_9f8e7d6c5b4a"

// A refusal that names a secret, as given or in base64, says it masked; the plane's log does too.
func TestRefusalAndLogMasked(t *testing.T) {
	p, h := handler(t)
	putEnv(t, p, workspace.Environment{Name: "web", Branch: "main", Secrets: map[string]string{"STRIPE_KEY": held}})
	for _, name := range []string{held, base64.URLEncoding.EncodeToString([]byte(held))} {
		res := call(h, "GET", "api-dev.nvoi.to", "/environments/"+name, "", bearer)
		if res.Code != 404 || detail(res) != "no environment "+mask.Marker || strings.Contains(res.Body.String(), name) {
			t.Errorf("%s: %d %s", name, res.Code, res.Body)
		}
	}
	var out bytes.Buffer
	l := log.New(maskedLog{p.ws, &out}, "", 0)
	l.Printf("pushing with %s, then a plain line", held)
	if out.String() != "pushing with "+mask.Marker+", then a plain line\n" {
		t.Errorf("log %q", out.String())
	}
}
