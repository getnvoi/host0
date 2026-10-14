package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/cmd/hz/state"
	"github.com/getnvoi/host0/internal/api/client"
)

// An operation of the plane's API as hz runs it; commands.gen.go lists every one.
type operation struct {
	ID, Short, Method, Route string
	HZ                       hz
	// Path parameters, in order: the command's arguments.
	Args        []string
	Query, Body []param
	ContentType string
	Call        func(ctx context.Context, c *client.Client, args []string, body io.Reader, edit client.RequestEditorFn) (*http.Response, error)
}

// The operation's x-hz extension: how its answer is shown, and the hand-written commands that stand for it.
type hz struct {
	Output  string
	Columns []string
	Field   string
	By      []string
}

// A query or body field, as a flag: string, int, bool, list (repeated) or map (repeated KEY=VALUE).
type param struct{ Name, Kind, Help string }

// The plane ~/.hz/state.json names, with the token it holds.
func api() (*client.Client, error) {
	st, err := state.Load()
	if err != nil {
		return nil, err
	}
	return connect(st)
}

func connect(st state.State) (*client.Client, error) {
	return client.NewClient(st.URL, client.WithRequestEditorFn(func(_ context.Context, r *http.Request) error {
		r.Header.Set("Authorization", "Bearer "+st.Token)
		return nil
	}))
}

// The command an operation becomes when no hand-written one stands for it.
func (o operation) command() *cobra.Command {
	words := strings.Split(o.ID, ".")
	use := words[len(words)-1]
	for _, a := range o.Args {
		use += " <" + a + ">"
	}
	var output string
	values := map[string]any{}
	cmd := &cobra.Command{Use: use, Short: o.Short, Args: cobra.ExactArgs(len(o.Args))}
	f := cmd.Flags()
	for _, fl := range append(append([]param{}, o.Query...), o.Body...) {
		switch fl.Kind {
		case "string":
			values[fl.Name] = f.String(fl.Name, "", fl.Help)
		case "int":
			values[fl.Name] = f.Int(fl.Name, 0, fl.Help)
		case "bool":
			values[fl.Name] = f.Bool(fl.Name, false, fl.Help)
		case "list":
			values[fl.Name] = f.StringArray(fl.Name, nil, fl.Help)
		case "map":
			values[fl.Name] = f.StringArray(fl.Name, nil, fl.Help+" (KEY=VALUE, repeated)")
		}
	}
	f.StringVarP(&output, "output", "o", "", "json: the plane's answer as it is")
	cmd.RunE = func(c *cobra.Command, args []string) error {
		if output != "" && output != "json" {
			return fmt.Errorf("-o %s: want json", output)
		}
		pl, err := api()
		if err != nil {
			return err
		}
		query := url.Values{}
		for _, fl := range o.Query {
			if f.Changed(fl.Name) {
				v, err := value(fl, values[fl.Name])
				if err != nil {
					return err
				}
				query.Set(fl.Name, fmt.Sprint(v))
			}
		}
		var body io.Reader
		if o.ContentType != "" {
			in := map[string]any{}
			for _, fl := range o.Body {
				if f.Changed(fl.Name) {
					if in[fl.Name], err = value(fl, values[fl.Name]); err != nil {
						return err
					}
				}
			}
			if len(in) == 0 && o.Method == "PATCH" {
				var names []string
				for _, fl := range o.Body {
					names = append(names, "--"+fl.Name)
				}
				return fmt.Errorf("nothing to set: give %s", strings.Join(names, ", "))
			}
			b, err := json.Marshal(in)
			if err != nil {
				return err
			}
			body = bytes.NewReader(b)
		}
		edit := func(_ context.Context, r *http.Request) error {
			q := r.URL.Query()
			for k, v := range query {
				q[k] = v
			}
			r.URL.RawQuery = q.Encode()
			return nil
		}
		res, err := client.OK(o.Call(c.Context(), pl, args, body, edit))
		if err != nil {
			return err
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		if err != nil {
			return err
		}
		return show(c.OutOrStdout(), o.HZ, output, res.Header.Get("Content-Type"), raw)
	}
	return cmd
}

// A flag's value as the plane takes it.
func value(fl param, v any) (any, error) {
	switch v := v.(type) {
	case *string:
		return *v, nil
	case *int:
		return *v, nil
	case *bool:
		return *v, nil
	case *[]string:
		if fl.Kind == "list" {
			return *v, nil
		}
		m := map[string]string{}
		for _, kv := range *v {
			k, val, ok := strings.Cut(kv, "=")
			if !ok {
				return nil, fmt.Errorf("--%s %s: want KEY=VALUE", fl.Name, kv)
			}
			m[k] = val
		}
		return m, nil
	}
	return nil, fmt.Errorf("--%s: a flag of no kind", fl.Name)
}

// Prints the plane's answer as x says: a table of a list, the fields of an object, one field or the body as it is.
func show(w io.Writer, x hz, output, contentType string, raw []byte) error {
	isJSON := strings.Contains(contentType, "json")
	if output == "json" || x.Output == "raw" && x.Field == "" || !isJSON {
		if output == "json" && isJSON {
			var b bytes.Buffer
			if err := json.Indent(&b, raw, "", "  "); err != nil {
				return err
			}
			b.WriteByte('\n')
			_, err := w.Write(b.Bytes())
			return err
		}
		if x.Output == "none" {
			return nil
		}
		_, err := w.Write(raw)
		return err
	}
	if x.Output == "none" || len(raw) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return fmt.Errorf("the plane answered %q: %w", raw, err)
	}
	if x.Field != "" {
		m, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("the plane's answer has no field %s: %s", x.Field, raw)
		}
		v = m[x.Field]
	}
	switch x.Output {
	case "raw":
		s := cell(v)
		if !strings.HasSuffix(s, "\n") {
			s += "\n"
		}
		_, err := io.WriteString(w, s)
		return err
	case "fields":
		m, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("the plane's answer is not an object: %s", raw)
		}
		t := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
		for _, k := range columns(x.Columns, m) {
			fmt.Fprintf(t, "%s\t%s\n", k, cell(m[k]))
		}
		return t.Flush()
	case "table":
		rows, ok := v.([]any)
		if !ok && v != nil {
			return fmt.Errorf("the plane's answer is not a list: %s", raw)
		}
		t := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
		var cols []string
		if len(rows) > 0 {
			if m, ok := rows[0].(map[string]any); ok {
				cols = columns(x.Columns, m)
			}
		} else {
			cols = x.Columns
		}
		if len(cols) > 0 {
			fmt.Fprintln(t, strings.ToUpper(strings.Join(cols, "\t")))
		}
		for _, r := range rows {
			m, ok := r.(map[string]any)
			if !ok {
				fmt.Fprintln(t, cell(r))
				continue
			}
			cells := make([]string, len(cols))
			for i, c := range cols {
				cells[i] = cell(m[c])
			}
			fmt.Fprintln(t, strings.Join(cells, "\t"))
		}
		return t.Flush()
	}
	return fmt.Errorf("x-hz output %q: want table, fields, raw or none", x.Output)
}

// The columns named, or every key of m in order.
func columns(named []string, m map[string]any) []string {
	if len(named) > 0 {
		return named
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func cell(v any) string {
	switch v := v.(type) {
	case nil:
		return ""
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	case []any:
		cells := make([]string, len(v))
		for i, e := range v {
			if _, nested := e.(map[string]any); nested {
				b, _ := json.Marshal(v)
				return string(b)
			}
			cells[i] = cell(e)
		}
		return strings.Join(cells, ",")
	case map[string]any:
		var pairs []string
		for _, k := range columns(nil, v) {
			if _, nested := v[k].(map[string]any); nested {
				b, _ := json.Marshal(v)
				return string(b)
			}
			pairs = append(pairs, k+"="+cell(v[k]))
		}
		return strings.Join(pairs, " ")
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// The hand-written commands, by path: each stands for the operations whose x-hz.by names it.
var written = map[string]func() *cobra.Command{}

// What each group of commands is for.
var groups = map[string]string{
	"env":      "Environments: what a seed is built from and sessions fork",
	"session":  "Sessions: a fork of the seed and the agent working in it",
	"approval": "Actions waiting for a decision",
	"llm":      "Agent credentials; hz credentials adds one",
	"cluster":  "The cluster: its install, its shape and what runs on it",
}

// Adds every operation's command to root: generated when its x-hz names an output, and the hand-written ones its
// x-hz.by names, which replace a generated one of the same path. A hand-written command no operation names is a
// mistake in this binary, and it does not start.
func Attach(root *cobra.Command) {
	named := map[string]bool{}
	for _, o := range operations {
		for _, by := range o.HZ.By {
			named[by] = true
		}
	}
	var paths []string
	for path := range written {
		if !named[path] {
			panic("hz " + path + " is hand-written but no operation's x-hz.by names it")
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, o := range operations {
		if o.HZ.Output != "" {
			place(root, strings.Split(o.ID, "."), o.command())
		}
	}
	for _, path := range paths {
		place(root, strings.Fields(path), written[path]())
	}
	for path, c := range legacy() {
		place(root, strings.Fields(path), c())
	}
}

// Puts cmd at path under root, making the groups on the way; a command already there gives cmd its children.
func place(root *cobra.Command, path []string, cmd *cobra.Command) {
	parent := root
	for _, w := range path[:len(path)-1] {
		next := child(parent, w)
		if next == nil {
			next = &cobra.Command{Use: w, Short: groups[w]}
			parent.AddCommand(next)
		}
		parent = next
	}
	name := path[len(path)-1]
	if cmd.Name() != name {
		panic("hz " + strings.Join(path, " ") + ": the command is named " + cmd.Name())
	}
	if old := child(parent, name); old != nil {
		for _, c := range old.Commands() {
			old.RemoveCommand(c)
			cmd.AddCommand(c)
		}
		parent.RemoveCommand(old)
	}
	parent.AddCommand(cmd)
}

func child(parent *cobra.Command, name string) *cobra.Command {
	for _, c := range parent.Commands() {
		if c.Name() == name {
			return c
		}
	}
	return nil
}
