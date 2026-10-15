// Replaces each credential the plane holds, and its common encodings, with Marker wherever it appears in a text.
// A backstop: a value split or encoded some other way gets through.
package mask

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"sort"
	"strings"
)

const (
	Marker = "[secret]"
	// A value shorter than this is left alone: it would mask ordinary words.
	Min = 8
)

type Masker struct {
	r *strings.Replacer
}

// A masker of values, each with its base64, URL-escaped and JSON-escaped forms; the longest is replaced first, so a
// value that contains another is masked whole.
func New(values ...string) *Masker {
	seen := map[string]bool{}
	for _, v := range values {
		if len(v) < Min {
			continue
		}
		for _, f := range forms(v) {
			if len(f) >= Min {
				seen[f] = true
			}
		}
	}
	all := make([]string, 0, len(seen))
	for f := range seen {
		all = append(all, f)
	}
	sort.Slice(all, func(i, j int) bool {
		if len(all[i]) != len(all[j]) {
			return len(all[i]) > len(all[j])
		}
		return all[i] < all[j]
	})
	pairs := make([]string, 0, 2*len(all))
	for _, f := range all {
		pairs = append(pairs, f, Marker)
	}
	return &Masker{r: strings.NewReplacer(pairs...)}
}

func (m *Masker) String(s string) string {
	if m == nil {
		return s
	}
	return m.r.Replace(s)
}

func (m *Masker) Bytes(b []byte) []byte {
	if m == nil || len(b) == 0 {
		return b
	}
	return []byte(m.r.Replace(string(b)))
}

// v as it may appear in a text: itself, base64 (standard and URL, and at each of the three byte alignments inside a
// longer encoding), URL-escaped, and inside a JSON string.
func forms(v string) []string {
	out := []string{v, url.QueryEscape(v), url.PathEscape(v)}
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.URLEncoding} {
		out = append(out, enc.EncodeToString([]byte(v)))
		raw := enc.WithPadding(base64.NoPadding)
		for pad := range 3 {
			s := raw.EncodeToString(append(make([]byte, pad), v...))
			// Only the characters every bit of which comes from v: past the pad bytes, before a partial last group.
			out = append(out, s[(8*pad+5)/6:8*(pad+len(v))/6])
		}
	}
	// Marshal escapes <, > and & as well; an encoder told not to is how most JSON is written.
	q, _ := json.Marshal(v)
	out = append(out, string(q[1:len(q)-1]))
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if e.Encode(v) == nil {
		q = bytes.TrimSpace(b.Bytes())
		out = append(out, string(q[1:len(q)-1]))
	}
	return out
}

// The strings of a JSON value, a login file's tokens for one; nothing when s is not JSON.
func Strings(s string) []string {
	var v any
	if json.Unmarshal([]byte(s), &v) != nil {
		return nil
	}
	var out []string
	var walk func(any)
	walk = func(v any) {
		switch v := v.(type) {
		case string:
			out = append(out, v)
		case []any:
			for _, x := range v {
				walk(x)
			}
		case map[string]any:
			for _, x := range v {
				walk(x)
			}
		}
	}
	walk(v)
	return out
}
