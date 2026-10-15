package remote

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/spf13/cobra"

	"github.com/getnvoi/host0/internal/api/client"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/workspace"
)

func init() {
	written["credentials"] = credentials
	written["credentials ls"] = credentialsLs
}

func credentials() *cobra.Command {
	var github, provider, name string
	var set, secret []string
	cmd := &cobra.Command{
		Use:   "credentials",
		Short: "Hand the plane a GitHub token (default: gh auth token) and the agent's credential (default: claude setup-token; for codex OPENAI_API_KEY, else ~/.codex/auth.json)",
		Example: `  h0 credentials --set kind=api_key --secret token=ANTHROPIC_API_KEY
  h0 credentials --set kind=bearer --set base_url=https://api.z.ai/api/anthropic --secret token=ZAI_API_KEY
  h0 credentials --llm codex
  h0 credentials --llm codex --secret token=OPENAI_API_KEY --set model=gpt-5`,
		Args: cobra.NoArgs,
		RunE: func(cc *cobra.Command, _ []string) error {
			ctx := cc.Context()
			c := workspace.CredentialsInput{GitHub: os.Getenv(github)}
			l := workspace.LLMConfigInput{Name: name, Provider: provider, Values: map[string]string{}, Main: true}
			if c.GitHub == "" {
				out, err := exec.Command("gh", "auth", "token").Output()
				if err != nil {
					return fmt.Errorf("gh auth token: %w", err)
				}
				c.GitHub = strings.TrimSpace(string(out))
			}
			for _, kv := range set {
				k, v, ok := strings.Cut(kv, "=")
				if !ok {
					return fmt.Errorf("--set %s: want key=value", kv)
				}
				l.Values[k] = v
			}
			for _, kv := range secret {
				k, name, ok := strings.Cut(kv, "=")
				if !ok {
					return fmt.Errorf("--secret %s: want key=VARIABLE", kv)
				}
				if l.Values[k] = os.Getenv(name); l.Values[k] == "" {
					return fmt.Errorf("%s is not set in this shell", name)
				}
			}
			if len(set)+len(secret) == 0 {
				switch provider {
				case "claude_code":
					token, err := claudeToken()
					if err != nil {
						return err
					}
					l.Values["kind"], l.Values["token"] = "oauth", token
				case "codex":
					token, err := codexToken()
					if err != nil {
						return err
					}
					l.Values["token"] = token
				}
			}
			pl, err := api()
			if err != nil {
				return err
			}
			body, err := jsonBody(c)
			if err != nil {
				return err
			}
			if err := client.Done(pl.CredentialsPutWithBody(ctx, "application/json", body)); err != nil {
				return err
			}
			if l.Name == "" {
				ps, err := client.Read[[]llm.Provider](pl.LlmProviders(ctx))
				if err != nil {
					return err
				}
				for _, p := range ps {
					if p.Key == provider {
						l.Name = p.Label
					}
				}
				if l.Name == "" {
					return fmt.Errorf("the plane has no provider %s", provider)
				}
			}
			all, err := client.Read[[]workspace.LLMConfig](pl.LlmLs(ctx))
			if err != nil {
				return err
			}
			if slices.ContainsFunc(all, func(o workspace.LLMConfig) bool { return o.Name == l.Name }) {
				body, err := jsonBody(workspace.LLMConfigValues{Values: l.Values})
				if err != nil {
					return err
				}
				if err := client.Done(pl.LlmSetWithBody(ctx, l.Name, "application/json", body)); err != nil {
					return err
				}
				return client.Done(pl.LlmUse(ctx, l.Name))
			}
			body, err = jsonBody(l)
			if err != nil {
				return err
			}
			return client.Done(pl.LlmAddWithBody(ctx, "application/json", body))
		},
	}
	cmd.Flags().StringVar(&github, "github-env", "GITHUB_TOKEN", "variable holding the GitHub token")
	cmd.Flags().StringVar(&name, "name", "", "the credential's label (default: the provider's name); it becomes the one in use")
	cmd.Flags().StringVar(&provider, "llm", "claude_code", "the agent CLI the credential is for: claude_code or codex")
	cmd.Flags().StringArrayVar(&set, "set", nil, "a credential field, key=value")
	cmd.Flags().StringArrayVar(&secret, "secret", nil, "a credential field read from this shell, key=VARIABLE")
	return cmd
}

func credentialsLs() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "ls",
		Short: "Which credentials are set, never their values, and the agent credentials",
		Args:  cobra.NoArgs,
		RunE: func(cc *cobra.Command, _ []string) error {
			pl, err := api()
			if err != nil {
				return err
			}
			c, err := client.Read[workspace.CredentialsSet](pl.CredentialsGet(cc.Context()))
			if err != nil {
				return err
			}
			cs, err := client.Read[[]workspace.LLMConfig](pl.LlmLs(cc.Context()))
			if err != nil {
				return err
			}
			if output != "" {
				return asJSON(cc.OutOrStdout(), output, map[string]any{"stored": c.Stored, "llm": cs})
			}
			github := "not set"
			if slices.Contains(c.Stored, "github") {
				github = "set"
			}
			w := table(cc.OutOrStdout())
			fmt.Fprintf(w, "github  %s\n\nLLM\tPROVIDER\tSTATE\tSTORED\tVALUES\n", github)
			for _, c := range cs {
				st := ""
				switch {
				case c.Archived != nil:
					st = "archived"
				case c.Main:
					st = "in use"
				}
				var vs []string
				for _, k := range keys(c.Values) {
					vs = append(vs, k+"="+c.Values[k])
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", c.Name, c.Provider, st, strings.Join(c.Stored, ","), strings.Join(vs, " "))
			}
			return w.Flush()
		},
	}
	outputFlag(cmd, &output)
	return cmd
}

// OPENAI_API_KEY, else a copy of this machine's ChatGPT sign-in.
func codexToken() (string, error) {
	if t := os.Getenv("OPENAI_API_KEY"); t != "" {
		return t, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	auth, err := os.ReadFile(filepath.Join(home, ".codex", "auth.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("no OPENAI_API_KEY in this shell and no ~/.codex/auth.json (codex login); or --secret token=VARIABLE")
	}
	return string(auth), err
}

// CLAUDE_CODE_OAUTH_TOKEN, or a new one from claude setup-token, which opens a browser and prints the token last.
func claudeToken() (string, error) {
	if t := os.Getenv("CLAUDE_CODE_OAUTH_TOKEN"); t != "" {
		return t, nil
	}
	var b bytes.Buffer
	setup := exec.Command("claude", "setup-token")
	setup.Stdin, setup.Stdout, setup.Stderr = os.Stdin, io.MultiWriter(os.Stdout, &b), os.Stderr
	if err := setup.Run(); err != nil {
		return "", fmt.Errorf("claude setup-token: %w", err)
	}
	for _, f := range strings.Fields(b.String()) {
		if strings.HasPrefix(f, "sk-ant-oat") {
			return f, nil
		}
	}
	return "", fmt.Errorf("claude setup-token printed no token")
}
