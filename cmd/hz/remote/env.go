package remote

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/getnvoi/host0/internal/workspace"
)

// An environment as a YAML file holds it: secrets by name, their values read from the shell that applies it.
type document struct {
	workspace.Environment `yaml:",inline"`
	Secrets               []string `yaml:"secrets"`
}

// The environment in file, and the names of its secrets. A key the environment does not have is refused.
func decode(file string, raw []byte) (workspace.Environment, []string, error) {
	var doc document
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(&doc); err != nil {
		return doc.Environment, nil, fmt.Errorf("%s: %w", file, err)
	}
	if doc.Name == "" {
		return doc.Environment, nil, fmt.Errorf("%s: no name", file)
	}
	return doc.Environment, doc.Secrets, nil
}

func encode(e workspace.Environment) ([]byte, error) {
	doc := document{Environment: e, Secrets: keys(e.Secrets)}
	doc.Environment.Secrets = nil
	return yaml.Marshal(doc)
}

func envPath(name string) string { return "/environments/" + url.PathEscape(name) }

func getEnv(name string) (workspace.Environment, error) {
	var e workspace.Environment
	return e, call("GET", envPath(name), nil, &e)
}

func patch(name string, change map[string]any) error {
	return call("PATCH", envPath(name), change, nil)
}

func table() *tabwriter.Writer { return tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0) }

func env() *cobra.Command {
	cmd := &cobra.Command{Use: "env", Short: "Environments: what a seed is built from and sessions fork"}
	cmd.AddCommand(&cobra.Command{
		Use:   "apply <file>",
		Short: "Declare an environment from a YAML file; names under secrets: are read from this shell",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			raw, err := os.ReadFile(args[0])
			if err != nil {
				return err
			}
			e, names, err := decode(args[0], raw)
			if err != nil {
				return err
			}
			e.Secrets = map[string]string{}
			for _, n := range names {
				if e.Secrets[n] = os.Getenv(n); e.Secrets[n] == "" {
					return fmt.Errorf("secret %s is not set in this shell", n)
				}
			}
			return call("PUT", envPath(e.Name), e, nil)
		},
	}, &cobra.Command{
		Use:   "ls",
		Short: "Every environment, and whether it has a ready seed",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var es []workspace.EnvironmentSummary
			if err := call("GET", "/environments", nil, &es); err != nil {
				return err
			}
			w := table()
			fmt.Fprintln(w, "NAME\tREPO\tBRANCH\tTIER\tSEED")
			for _, e := range es {
				seed := "none"
				if e.Ready {
					seed = "ready"
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", e.Name, e.Repo, e.Branch, e.Tier, seed)
			}
			return w.Flush()
		},
	}, envGet(), &cobra.Command{
		Use:   "rm <env>",
		Short: "Remove the environment and its seed; refused while a session uses it",
		Args:  cobra.ExactArgs(1),
		RunE:  func(_ *cobra.Command, args []string) error { return call("DELETE", envPath(args[0]), nil, nil) },
	}, envCreate(), envSet(), &cobra.Command{
		Use:   "suspend <env>",
		Short: "Suspend the actor the environment's preview routes to, freeing its worker",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			var out struct{ Actor string }
			if err := call("POST", "/seeds/"+url.PathEscape(args[0])+"/suspend", nil, &out); err != nil {
				return err
			}
			fmt.Printf("suspended %s\n", out.Actor)
			return nil
		},
	}, seed(), vars(), secrets(), setup(), services(), tools())
	return cmd
}

func envGet() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "get <env>",
		Short: "The environment; -o yaml prints a file hz env apply takes back",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			switch output {
			case "yaml":
				b, err := encode(e)
				if err != nil {
					return err
				}
				_, err = os.Stdout.Write(b)
				return err
			case "json":
				b, err := json.MarshalIndent(e, "", "  ")
				if err != nil {
					return err
				}
				fmt.Println(string(b))
				return nil
			case "":
				return describe(e)
			}
			return fmt.Errorf("-o %s: want yaml or json", output)
		},
	}
	cmd.Flags().StringVarP(&output, "output", "o", "", "yaml or json")
	return cmd
}

func describe(e workspace.Environment) error {
	w := table()
	tier := e.Tier
	if tier == "" {
		tier = "medium"
	}
	fmt.Fprintf(w, "name\t%s\nrepo\t%s\nbranch\t%s\nimage\t%s\npreview\t%d\ntier\t%s\n", e.Name, e.Repo, e.Branch, e.Image, e.Preview, tier)
	for _, k := range keys(e.Env) {
		fmt.Fprintf(w, "var\t%s=%s\n", k, e.Env[k])
	}
	for _, k := range keys(e.Secrets) {
		fmt.Fprintf(w, "secret\t%s\n", k)
	}
	for i, s := range e.Setup {
		fmt.Fprintf(w, "setup %d\t%s\n", i+1, s)
	}
	for _, s := range e.Services {
		fmt.Fprintf(w, "service\t%s\n", service(s))
	}
	for _, k := range keys(e.Tools) {
		fmt.Fprintf(w, "tool\t%s %s\n", k, e.Tools[k])
	}
	return w.Flush()
}

func service(s workspace.Service) string {
	out := s.Name
	if s.Port != 0 {
		out += " :" + strconv.Itoa(s.Port)
	}
	if s.Image != "" {
		out += " image " + s.Image
	}
	if s.Early {
		out += " early"
	}
	for _, k := range keys(s.Env) {
		out += " " + k + "=" + s.Env[k]
	}
	return out + "  " + s.Command
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func envCreate() *cobra.Command {
	var e workspace.Environment
	cmd := &cobra.Command{
		Use:   "create <env>",
		Short: "A new environment; refused when the name is taken",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			if _, err := getEnv(args[0]); err == nil {
				return fmt.Errorf("environment %s exists: change it with hz env set", args[0])
			} else if !missing(err) {
				return err
			}
			e.Name = args[0]
			return call("PUT", envPath(e.Name), e, nil)
		},
	}
	f := cmd.Flags()
	f.StringVar(&e.Repo, "repo", "", "GitHub repository, owner/name")
	f.StringVar(&e.Branch, "branch", "", "branch sessions start from")
	f.StringVar(&e.Image, "image", "", "the image its services run in")
	f.IntVar(&e.Preview, "preview", 0, "the port the preview serves")
	f.StringVar(&e.Tier, "tier", "", "small, medium (default) or large")
	for _, name := range []string{"repo", "branch", "image", "preview"} {
		if err := cmd.MarkFlagRequired(name); err != nil {
			panic(err)
		}
	}
	return cmd
}

func envSet() *cobra.Command {
	var e workspace.Environment
	cmd := &cobra.Command{
		Use:   "set <env>",
		Short: "Change the environment's fields; the seed is rebuilt by hz env seed",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			change := map[string]any{}
			for flag, v := range map[string]any{"repo": e.Repo, "branch": e.Branch, "image": e.Image, "preview": e.Preview, "tier": e.Tier} {
				if c.Flags().Changed(flag) {
					change[flag] = v
				}
			}
			if len(change) == 0 {
				return fmt.Errorf("nothing to set: give --repo, --branch, --image, --preview or --tier")
			}
			return patch(args[0], change)
		},
	}
	f := cmd.Flags()
	f.StringVar(&e.Repo, "repo", "", "GitHub repository, owner/name")
	f.StringVar(&e.Branch, "branch", "", "branch sessions start from")
	f.StringVar(&e.Image, "image", "", "the image its services run in")
	f.IntVar(&e.Preview, "preview", 0, "the port the preview serves")
	f.StringVar(&e.Tier, "tier", "", "small, medium or large")
	return cmd
}

func vars() *cobra.Command {
	cmd := &cobra.Command{Use: "var", Short: "The environment's variables"}
	cmd.AddCommand(&cobra.Command{
		Use:   "set <env> <KEY> <VALUE>",
		Short: "Set a variable",
		Args:  cobra.ExactArgs(3),
		RunE: func(_ *cobra.Command, args []string) error {
			return patch(args[0], map[string]any{"env": map[string]any{args[1]: args[2]}})
		},
	}, &cobra.Command{
		Use:   "rm <env> <KEY>",
		Short: "Remove a variable",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			if _, ok := e.Env[args[1]]; !ok {
				return fmt.Errorf("environment %s has no variable %s", args[0], args[1])
			}
			return patch(args[0], map[string]any{"env": map[string]any{args[1]: nil}})
		},
	})
	return cmd
}

func secrets() *cobra.Command {
	cmd := &cobra.Command{Use: "secret", Short: "The environment's secrets; values are never shown"}
	cmd.AddCommand(&cobra.Command{
		Use:   "set <env> <NAME>",
		Short: "The value of NAME in this shell, or else what is piped in",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			v, err := secretValue(args[1])
			if err != nil {
				return err
			}
			return patch(args[0], map[string]any{"secrets": map[string]any{args[1]: v}})
		},
	}, &cobra.Command{
		Use:   "rm <env> <NAME>",
		Short: "Remove a secret",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			if _, ok := e.Secrets[args[1]]; !ok {
				return fmt.Errorf("environment %s has no secret %s", args[0], args[1])
			}
			return patch(args[0], map[string]any{"secrets": map[string]any{args[1]: nil}})
		},
	})
	return cmd
}

func secretValue(name string) (string, error) {
	if v := os.Getenv(name); v != "" {
		return v, nil
	}
	st, err := os.Stdin.Stat()
	if err != nil {
		return "", err
	}
	if st.Mode()&os.ModeCharDevice != 0 {
		return "", fmt.Errorf("%s is not set in this shell, and nothing is piped in", name)
	}
	b, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", err
	}
	v := strings.TrimRight(string(b), "\r\n")
	if v == "" {
		return "", fmt.Errorf("%s: what was piped in is empty", name)
	}
	return v, nil
}

func setup() *cobra.Command {
	cmd := &cobra.Command{Use: "setup", Short: "The commands the seed runs in the checkout, in order"}
	cmd.AddCommand(&cobra.Command{
		Use:   "ls <env>",
		Short: "The setup commands, numbered",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			for i, s := range e.Setup {
				fmt.Printf("%d  %s\n", i+1, s)
			}
			return nil
		},
	}, &cobra.Command{
		Use:   "add <env> <command>",
		Short: "Append a command",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			return patch(args[0], map[string]any{"setup": append(e.Setup, args[1])})
		},
	}, &cobra.Command{
		Use:   "rm <env> <n>",
		Short: "Remove command n, as setup ls numbers it",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[1])
			if err != nil || n < 1 || n > len(e.Setup) {
				return fmt.Errorf("environment %s has no setup command %s", args[0], args[1])
			}
			return patch(args[0], map[string]any{"setup": slices.Delete(e.Setup, n-1, n)})
		},
	})
	return cmd
}

func services() *cobra.Command {
	cmd := &cobra.Command{Use: "service", Short: "The processes the seed starts and every fork keeps running"}
	cmd.AddCommand(&cobra.Command{
		Use:   "ls <env>",
		Short: "The services",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			for _, s := range e.Services {
				fmt.Println(service(s))
			}
			return nil
		},
	}, serviceEdit(true), serviceEdit(false), &cobra.Command{
		Use:   "rm <env> <name>",
		Short: "Remove a service",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			i := slices.IndexFunc(e.Services, func(s workspace.Service) bool { return s.Name == args[1] })
			if i < 0 {
				return fmt.Errorf("environment %s has no service %s", args[0], args[1])
			}
			return patch(args[0], map[string]any{"services": slices.Delete(e.Services, i, i+1)})
		},
	})
	return cmd
}

// add: a new service, refused when the name is taken. Otherwise set: the flags given change an existing one.
func serviceEdit(add bool) *cobra.Command {
	var s workspace.Service
	var env []string
	use, short := "set <env> <name>", "Change a service's fields"
	if add {
		use, short = "add <env> <name>", "A new service"
	}
	cmd := &cobra.Command{
		Use:   use,
		Short: short,
		Args:  cobra.ExactArgs(2),
		RunE: func(c *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			i := slices.IndexFunc(e.Services, func(s workspace.Service) bool { return s.Name == args[1] })
			switch {
			case add && i >= 0:
				return fmt.Errorf("environment %s has a service %s: change it with hz env service set", args[0], args[1])
			case !add && i < 0:
				return fmt.Errorf("environment %s has no service %s", args[0], args[1])
			case add:
				e.Services = append(e.Services, workspace.Service{Name: args[1]})
				i = len(e.Services) - 1
			}
			cur := &e.Services[i]
			f := c.Flags()
			if f.Changed("command") {
				cur.Command = s.Command
			}
			if f.Changed("port") {
				cur.Port = s.Port
			}
			if f.Changed("image") {
				cur.Image = s.Image
			}
			if f.Changed("early") {
				cur.Early = s.Early
			}
			for _, kv := range env {
				k, v, ok := strings.Cut(kv, "=")
				if !ok {
					return fmt.Errorf("--env %s: want KEY=VALUE", kv)
				}
				if cur.Env == nil {
					cur.Env = map[string]string{}
				}
				cur.Env[k] = v
			}
			if !add && f.NFlag() == 0 {
				return fmt.Errorf("nothing to set: give --command, --port, --image, --early or --env")
			}
			return patch(args[0], map[string]any{"services": e.Services})
		},
	}
	f := cmd.Flags()
	f.StringVar(&s.Command, "command", "", "what it runs, by sh -c")
	f.IntVar(&s.Port, "port", 0, "the port it listens on")
	f.StringVar(&s.Image, "image", "", "its image (default: the environment's)")
	f.BoolVar(&s.Early, "early", false, "start before the checkout is ready")
	f.StringArrayVar(&env, "env", nil, "a variable for it alone, KEY=VALUE")
	if add {
		if err := cmd.MarkFlagRequired("command"); err != nil {
			panic(err)
		}
	}
	return cmd
}

func tools() *cobra.Command {
	cmd := &cobra.Command{Use: "tool", Short: "What a session's tool does when called: auto, approval or deny"}
	cmd.AddCommand(&cobra.Command{
		Use:   "set <env> <tool> <auto|approval|deny>",
		Short: "Set the tool's policy",
		Args:  cobra.ExactArgs(3),
		RunE: func(_ *cobra.Command, args []string) error {
			return patch(args[0], map[string]any{"tools": map[string]any{args[1]: args[2]}})
		},
	}, &cobra.Command{
		Use:   "rm <env> <tool>",
		Short: "Back to the tool's default policy",
		Args:  cobra.ExactArgs(2),
		RunE: func(_ *cobra.Command, args []string) error {
			e, err := getEnv(args[0])
			if err != nil {
				return err
			}
			if _, ok := e.Tools[args[1]]; !ok {
				return fmt.Errorf("environment %s sets no policy for %s", args[0], args[1])
			}
			return patch(args[0], map[string]any{"tools": map[string]any{args[1]: nil}})
		},
	})
	return cmd
}
