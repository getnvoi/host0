// Writes hz's commands from the plane's spec: one per operation, its path the operation id split on dots, its
// path parameters as arguments, its query and body fields as flags, its output as the x-hz extension says.
//
//	go run ./hzgen <spec> <out.go>
package main

import (
	"bytes"
	"fmt"
	"go/format"
	"log"
	"os"
	"sort"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: hzgen <spec> <out.go>")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	src, err := Generate(raw)
	if err != nil {
		log.Fatalf("%s: %v", os.Args[1], err)
	}
	if err := os.WriteFile(os.Args[2], src, 0o644); err != nil {
		log.Fatal(err)
	}
}

type spec struct {
	Paths      map[string]map[string]operation `yaml:"paths"`
	Components struct {
		Schemas map[string]schema `yaml:"schemas"`
	} `yaml:"components"`
}

type operation struct {
	ID          string      `yaml:"operationId"`
	Summary     string      `yaml:"summary"`
	Parameters  []parameter `yaml:"parameters"`
	RequestBody *struct {
		Content map[string]struct {
			Schema schema `yaml:"schema"`
		} `yaml:"content"`
	} `yaml:"requestBody"`
	HZ hz `yaml:"x-hz"`
}

type parameter struct {
	Name        string `yaml:"name"`
	In          string `yaml:"in"`
	Description string `yaml:"description"`
	Schema      schema `yaml:"schema"`
}

type schema struct {
	Ref                  string            `yaml:"$ref"`
	Type                 string            `yaml:"type"`
	Description          string            `yaml:"description"`
	Properties           map[string]schema `yaml:"properties"`
	Items                *schema           `yaml:"items"`
	AdditionalProperties any               `yaml:"additionalProperties"`
	WriteOnly            bool              `yaml:"writeOnly"`
}

type hz struct {
	Output  string   `yaml:"output"`
	Columns []string `yaml:"columns"`
	Field   string   `yaml:"field"`
	By      []string `yaml:"by"`
}

// A flag's kind: string, int, bool, a list of strings, or a map of strings given as KEY=VALUE.
func kind(s schema) (string, bool) {
	switch s.Type {
	case "string":
		return "string", true
	case "integer":
		return "int", true
	case "boolean":
		return "bool", true
	case "array":
		if s.Items != nil && s.Items.Type == "string" {
			return "list", true
		}
	case "object":
		if m, ok := s.AdditionalProperties.(map[string]any); ok && m["type"] == "string" {
			return "map", true
		}
	}
	return "", false
}

func strs(v []string) string {
	q := make([]string, len(v))
	for i, s := range v {
		q[i] = fmt.Sprintf("%q", s)
	}
	return "[]string{" + strings.Join(q, ", ") + "}"
}

// The name oapi-codegen gives a method: the id in CamelCase, split on its separators.
func camel(id string) string {
	var b strings.Builder
	up := true
	for _, r := range id {
		switch {
		case unicode.IsUpper(r), unicode.IsDigit(r):
			b.WriteRune(r)
		case unicode.IsLower(r):
			if up {
				r = unicode.ToUpper(r)
			}
			b.WriteRune(r)
		}
		up = strings.ContainsRune(".-+:;_~ (){}[]", r)
	}
	return b.String()
}

func Generate(raw []byte) ([]byte, error) {
	var s spec
	if err := yaml.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	type entry struct {
		path, method string
		op           operation
	}
	var all []entry
	for path, methods := range s.Paths {
		for method, op := range methods {
			all = append(all, entry{path, strings.ToUpper(method), op})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].op.ID < all[j].op.ID })
	var b bytes.Buffer
	numbers := false
	b.WriteString("var operations = []operation{\n")
	for _, e := range all {
		op := e.op
		if op.ID == "" {
			return nil, fmt.Errorf("%s %s has no operationId", e.method, e.path)
		}
		if op.HZ.Output == "" && len(op.HZ.By) == 0 {
			return nil, fmt.Errorf("%s: its x-hz names neither an output nor the commands that stand for it", op.ID)
		}
		fmt.Fprintf(&b, "{\nID: %q,\nShort: %q,\nMethod: %q,\nRoute: %q,\n", op.ID, op.Summary, e.method, e.path)
		var x []string
		if op.HZ.Output != "" {
			x = append(x, fmt.Sprintf("Output: %q", op.HZ.Output))
		}
		if len(op.HZ.Columns) > 0 {
			x = append(x, "Columns: "+strs(op.HZ.Columns))
		}
		if op.HZ.Field != "" {
			x = append(x, fmt.Sprintf("Field: %q", op.HZ.Field))
		}
		if len(op.HZ.By) > 0 {
			x = append(x, "By: "+strs(op.HZ.By))
		}
		fmt.Fprintf(&b, "HZ: hz{%s},\n", strings.Join(x, ", "))
		var args, query []parameter
		for _, p := range op.Parameters {
			switch p.In {
			case "path":
				args = append(args, p)
			case "query":
				query = append(query, p)
			}
		}
		// Path parameters in the order the path names them.
		sort.SliceStable(args, func(i, j int) bool {
			return strings.Index(e.path, "{"+args[i].Name+"}") < strings.Index(e.path, "{"+args[j].Name+"}")
		})
		var names []string
		for _, p := range args {
			names = append(names, p.Name)
		}
		if len(names) > 0 {
			fmt.Fprintf(&b, "Args: %s,\n", strs(names))
		}
		var flags []string
		for _, p := range query {
			k, ok := kind(p.Schema)
			if !ok {
				return nil, fmt.Errorf("%s: query %s is a %s, which no flag takes", op.ID, p.Name, p.Schema.Type)
			}
			flags = append(flags, fmt.Sprintf("{Name: %q, Kind: %q, Help: %q}", p.Name, k, p.Description))
		}
		if len(flags) > 0 {
			fmt.Fprintf(&b, "Query: []param{%s},\n", strings.Join(flags, ", "))
		}
		contentType := ""
		if op.RequestBody != nil {
			var types []string
			for ct := range op.RequestBody.Content {
				types = append(types, ct)
			}
			sort.Strings(types)
			contentType = types[0]
			body := op.RequestBody.Content[contentType].Schema
			if body.Ref != "" {
				body = s.Components.Schemas[strings.TrimPrefix(body.Ref, "#/components/schemas/")]
			}
			var props []string
			for name := range body.Properties {
				props = append(props, name)
			}
			sort.Strings(props)
			flags = nil
			for _, name := range props {
				// A secret never goes on a command line, where the shell's history keeps it.
				k, ok := kind(body.Properties[name])
				if !ok || body.Properties[name].WriteOnly {
					continue
				}
				flags = append(flags, fmt.Sprintf("{Name: %q, Kind: %q, Help: %q}", name, k, body.Properties[name].Description))
			}
			fmt.Fprintf(&b, "ContentType: %q,\n", contentType)
			if len(flags) > 0 {
				fmt.Fprintf(&b, "Body: []param{%s},\n", strings.Join(flags, ", "))
			}
		}
		b.WriteString("Call: func(ctx context.Context, c *client.Client, args []string, body io.Reader, edit client.RequestEditorFn) (*http.Response, error) {\n")
		call := []string{"ctx"}
		for i, p := range args {
			v := fmt.Sprintf("args[%d]", i)
			if p.Schema.Type == "integer" {
				numbers = true
				fmt.Fprintf(&b, "a%d, err := strconv.Atoi(args[%d])\nif err != nil {\nreturn nil, fmt.Errorf(\"%s %%q: not a number\", args[%d])\n}\n", i, i, p.Name, i)
				v = fmt.Sprintf("a%d", i)
			}
			call = append(call, v)
		}
		method := camel(op.ID)
		if len(query) > 0 {
			call = append(call, "&client."+method+"Params{}")
		}
		if contentType != "" {
			method += "WithBody"
			call = append(call, fmt.Sprintf("%q", contentType), "body")
		}
		call = append(call, "edit")
		fmt.Fprintf(&b, "return c.%s(%s)\n},\n},\n", method, strings.Join(call, ", "))
	}
	b.WriteString("}\n")
	var head bytes.Buffer
	head.WriteString("// Code generated by hzgen from internal/api/openapi.yaml. DO NOT EDIT.\n\npackage remote\n\nimport (\n")
	if numbers {
		head.WriteString("\"fmt\"\n\"strconv\"\n")
	}
	head.WriteString("\"context\"\n\"io\"\n\"net/http\"\n\n\"github.com/getnvoi/host0/internal/api/client\"\n)\n\n")
	head.Write(b.Bytes())
	out, err := format.Source(head.Bytes())
	if err != nil {
		return nil, fmt.Errorf("%w\n%s", err, head.Bytes())
	}
	return out, nil
}
