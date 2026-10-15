package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/workspace"
)

// The most of an answer an agent is told; the rest is cut.
const answerLimit = 16 << 10

// The plane's operations as tools: each one's schema from the spec, each call served in-process by the API's mux.
type toolbox struct {
	tools []workspace.Tool
	calls map[string]dispatch
	mux   http.Handler
}

// How a tool's input becomes its operation's request.
type dispatch struct {
	method, path  string
	params, query []string
	// Whether the input is the body's fields, or holds the body whole under "body" because a field would clash.
	body, whole bool
	// The body's media type: JSON, or a JSON merge patch.
	media string
}

// A tool's name: its operation id, dots as underscores, which MCP names allow.
func toolName(id string) string { return strings.ReplaceAll(id, ".", "_") }

// Reads every operation of a; their calls go to mux.
func (t *toolbox) load(a huma.API, mux http.Handler) {
	o := a.OpenAPI()
	defs := map[string]any{}
	raw, _ := json.Marshal(o.Components.Schemas.Map())
	json.Unmarshal(raw, &defs)
	t.tools, t.calls, t.mux = nil, map[string]dispatch{}, mux
	for path, item := range o.Paths {
		for method, op := range map[string]*huma.Operation{"GET": item.Get, "POST": item.Post, "PUT": item.Put,
			"PATCH": item.Patch, "DELETE": item.Delete} {
			if op == nil {
				continue
			}
			name := toolName(op.OperationID)
			c := dispatch{method: method, path: path}
			props, required := map[string]any{}, []string{}
			for _, p := range op.Parameters {
				var s map[string]any
				b, _ := json.Marshal(p.Schema)
				json.Unmarshal(b, &s)
				s["description"] = p.Description
				switch p.In {
				case "path":
					c.params = append(c.params, p.Name)
					required = append(required, p.Name)
				case "query":
					c.query = append(c.query, p.Name)
				default:
					continue
				}
				props[p.Name] = s
			}
			for media, mt := range bodies(op) {
				c.body, c.media = true, media
				b, _ := json.Marshal(mt.Schema)
				var s map[string]any
				json.Unmarshal(b, &s)
				s = inline(s, defs, 0).(map[string]any)
				fields, _ := s["properties"].(map[string]any)
				for f := range fields {
					c.whole = c.whole || props[f] != nil
				}
				if s["type"] != "object" || c.whole {
					c.whole = true
					props["body"] = s
					required = append(required, "body")
				} else {
					for f, fs := range fields {
						props[f] = fs
					}
					if req, ok := s["required"].([]any); ok {
						for _, r := range req {
							required = append(required, r.(string))
						}
					}
				}
			}
			sort.Strings(required)
			t.calls[name] = c
			t.tools = append(t.tools, workspace.Tool{Name: name, Description: op.Summary, Default: level(method, op),
				Schema: map[string]any{"type": "object", "properties": props, "required": required}})
		}
	}
	sort.Slice(t.tools, func(i, j int) bool { return t.tools[i].Name < t.tools[j].Name })
}

// The operation's JSON request body, under its media type: none, or one.
func bodies(op *huma.Operation) map[string]*huma.MediaType {
	out := map[string]*huma.MediaType{}
	if op.RequestBody == nil {
		return out
	}
	var types []string
	for media := range op.RequestBody.Content {
		if strings.HasSuffix(media, "json") {
			types = append(types, media)
		}
	}
	// application/json first, where there is one.
	sort.Strings(types)
	for _, media := range types[:min(len(types), 1)] {
		out[media] = op.RequestBody.Content[media]
	}
	return out
}

// An operation's level for an agent with no rule: its x-hz tool, else auto for a read and approval for a write. One
// only the CLI's token reaches is denied: an agent never holds that token.
func level(method string, op *huma.Operation) string {
	if len(op.Security) == 1 && op.Security[0]["bearer"] != nil {
		return "deny"
	}
	if x, ok := op.Extensions["x-hz"].(hz); ok && x.Tool != "" {
		return x.Tool
	}
	if method == "GET" {
		return "auto"
	}
	return "approval"
}

// v with every $ref to a component replaced by the component itself, depth levels down at most.
func inline(v any, defs map[string]any, depth int) any {
	switch v := v.(type) {
	case map[string]any:
		if ref, ok := v["$ref"].(string); ok {
			if depth > 8 {
				return map[string]any{"type": "object"}
			}
			return inline(defs[strings.TrimPrefix(ref, "#/components/schemas/")], defs, depth+1)
		}
		out := map[string]any{}
		for k, x := range v {
			if k == "$schema" {
				continue
			}
			out[k] = inline(x, defs, depth)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			out[i] = inline(x, defs, depth)
		}
		return out
	}
	return v
}

func (t *toolbox) List() []workspace.Tool { return t.tools }

// Serves the tool's operation as the agent, and says what came of it.
func (t *toolbox) Call(ctx context.Context, sid, agent, name, input string) string {
	c, ok := t.calls[name]
	if !ok {
		return name + ": failed: no such tool"
	}
	in := map[string]any{}
	if strings.TrimSpace(input) != "" {
		if err := json.Unmarshal([]byte(input), &in); err != nil {
			return name + ": failed: its input is not a JSON object: " + err.Error()
		}
	}
	path := c.path
	for _, p := range c.params {
		v, ok := in[p]
		if !ok {
			return name + ": failed: " + p + " is required"
		}
		path = strings.ReplaceAll(path, "{"+p+"}", url.PathEscape(text(v)))
		delete(in, p)
	}
	q := url.Values{}
	for _, p := range c.query {
		if v, ok := in[p]; ok {
			q.Set(p, text(v))
			delete(in, p)
		}
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var body []byte
	if c.body {
		var v any = in
		if c.whole {
			v = in["body"]
		}
		body, _ = json.Marshal(v)
	}
	req, err := http.NewRequestWithContext(auth.AsAgent(ctx, agent, sid), c.method, path, bytes.NewReader(body))
	if err != nil {
		return name + ": failed: " + err.Error()
	}
	if c.body {
		req.Header.Set("Content-Type", c.media)
	}
	rec := httptest.NewRecorder()
	t.mux.ServeHTTP(rec, req)
	out := bytes.TrimSpace(rec.Body.Bytes())
	if rec.Code >= 400 {
		var p struct {
			Detail string `json:"detail"`
		}
		if json.Unmarshal(out, &p) == nil && p.Detail != "" {
			return name + ": failed: " + p.Detail
		}
		return fmt.Sprintf("%s: failed: %d %s", name, rec.Code, out)
	}
	if len(out) == 0 {
		return name + ": done"
	}
	var compact bytes.Buffer
	if json.Compact(&compact, out) == nil {
		out = compact.Bytes()
	}
	if len(out) > answerLimit {
		return fmt.Sprintf("%s: %s… (cut at %d of %d bytes)", name, out[:answerLimit], answerLimit, len(out))
	}
	return name + ": " + string(out)
}

// A parameter's value as its URL carries it.
func text(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return string(b)
}
