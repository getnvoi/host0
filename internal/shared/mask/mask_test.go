package mask

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestMask(t *testing.T) {
	const secret = "sk_live_4f9a+b/c=d&e<f>"
	m := New(secret, "short", "")
	for _, in := range []string{
		"key " + secret + " end",
		"basic " + base64.StdEncoding.EncodeToString([]byte(secret)),
		"url " + base64.URLEncoding.EncodeToString([]byte(secret)),
		"q=" + url.QueryEscape(secret),
		"p/" + url.PathEscape(secret),
	} {
		got := m.String(in)
		if strings.Contains(got, "4f9a") || !strings.Contains(got, Marker) {
			t.Errorf("%q masked as %q", in, got)
		}
	}
	j, _ := json.Marshal(map[string]string{"k": secret})
	if got := m.String(string(j)); got != `{"k":"`+Marker+`"}` {
		t.Errorf("json masked as %s", got)
	}
	// Inside a longer base64 text, at every alignment: "user:" then the secret, as a basic auth header has it.
	for _, prefix := range []string{"u:", "us:", "use:"} {
		got := m.String(base64.StdEncoding.EncodeToString([]byte(prefix + secret + "-tail")))
		if !strings.Contains(got, Marker) {
			t.Errorf("base64 after %q not masked: %s", prefix, got)
		}
	}
	if got := m.String("a short word, nothing held"); got != "a short word, nothing held" {
		t.Errorf("plain text changed: %q", got)
	}
}

func TestLongestFirst(t *testing.T) {
	m := New("abcdefgh", "abcdefgh-longer")
	if got := m.String("x abcdefgh-longer y abcdefgh"); got != "x "+Marker+" y "+Marker {
		t.Errorf("got %q", got)
	}
	var none *Masker
	if none.String("abcdefgh") != "abcdefgh" {
		t.Error("a nil masker changed its text")
	}
}

func TestStrings(t *testing.T) {
	got := Strings(`{"tokens":{"access_token":"eyJ-access-123456","n":[1,"two"]}}`)
	if strings.Join(got, ",") != "eyJ-access-123456,two" && strings.Join(got, ",") != "two,eyJ-access-123456" {
		t.Errorf("got %v", got)
	}
	if Strings("not json") != nil {
		t.Error("text is not JSON")
	}
}
