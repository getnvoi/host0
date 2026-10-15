package workspace

import (
	"fmt"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
	"github.com/getnvoi/host0/internal/shared/mask"
)

// Every credential the plane holds: environment secrets, the secret fields of agent credentials (and the strings
// of a login file), the GitHub token, BoxToken and each token derived from it.
func (ws *Workspace) held() ([]string, error) {
	var out []string
	// Found whole rather than plucked: a sealed column opens only through its model.
	var secrets []db.Secret
	if err := ws.DB.Find(&secrets).Error; err != nil {
		return nil, fmt.Errorf("the secrets to mask: %w", err)
	}
	for _, s := range secrets {
		out = append(out, s.Value)
	}
	var creds []db.Credential
	if err := ws.DB.Find(&creds).Error; err != nil {
		return nil, fmt.Errorf("the credentials to mask: %w", err)
	}
	for _, c := range creds {
		out = append(out, c.Value)
	}
	var configs []db.LLMConfig
	if err := ws.DB.Find(&configs).Error; err != nil {
		return nil, fmt.Errorf("the agent credentials to mask: %w", err)
	}
	for _, c := range configs {
		out = append(out, secretValues(ws.Runners, c.Provider, c.Values)...)
	}
	if ws.BoxToken != "" {
		out = append(out, ws.BoxToken)
		var envs, sessions, seeds []string
		if err := ws.DB.Model(&db.Environment{}).Pluck("name", &envs).Error; err != nil {
			return nil, fmt.Errorf("the environments to mask: %w", err)
		}
		if err := ws.DB.Model(&db.Session{}).Pluck("public_id", &sessions).Error; err != nil {
			return nil, fmt.Errorf("the sessions to mask: %w", err)
		}
		if err := ws.DB.Model(&db.Seed{}).Where("actor != ''").Pluck("actor", &seeds).Error; err != nil {
			return nil, fmt.Errorf("the seeds to mask: %w", err)
		}
		for _, e := range envs {
			out = append(out, ws.derive("env", e))
		}
		for _, s := range sessions {
			out = append(out, ws.derive("actor", "wt-"+s))
		}
		for _, a := range seeds {
			out = append(out, ws.derive("actor", a))
		}
	}
	return out, nil
}

// The values of a credential's secret fields, as its runner names them; every value when no runner is known.
func secretValues(runners []llm.Runner, provider string, values map[string]string) []string {
	var keys []string
	if r, err := llm.Find(runners, provider); err == nil {
		for _, f := range r.Fields() {
			if f.Secret {
				keys = append(keys, f.Key)
			}
		}
	} else {
		for k := range values {
			keys = append(keys, k)
		}
	}
	var out []string
	for _, k := range keys {
		out = append(append(out, values[k]), mask.Strings(values[k])...)
	}
	return out
}

// Builds the masker again from the credentials held now.
func (ws *Workspace) Remask() error {
	values, err := ws.held()
	if err != nil {
		return err
	}
	ws.masks.Store(mask.New(values...))
	return nil
}

// The masker last built, built now when there is none.
func (ws *Workspace) masker() (*mask.Masker, error) {
	if m := ws.masks.Load(); m != nil {
		return m, nil
	}
	if err := ws.Remask(); err != nil {
		return nil, err
	}
	return ws.masks.Load(), nil
}

// s with every credential held replaced by mask.Marker. When the credentials cannot be read, nothing of s is shown.
func (ws *Workspace) Mask(s string) string {
	m, err := ws.masker()
	if err != nil {
		return mask.Marker + " (not shown: " + err.Error() + ")"
	}
	return m.String(s)
}

// err with its sentence masked, nil for nil; errors.As still finds what it wrapped.
func (ws *Workspace) MaskErr(err error) error {
	m, merr := ws.masker()
	if merr != nil && err != nil {
		return masked{ws.Mask(""), err}
	}
	return maskWith(m, err)
}

func maskWith(m *mask.Masker, err error) error {
	if err == nil {
		return nil
	}
	said := m.String(err.Error())
	if said == err.Error() {
		return err
	}
	return masked{said, err}
}

// A write's error, or else the masker built again from what the write left.
func (ws *Workspace) remasked(err error) error {
	if err != nil {
		return err
	}
	return ws.Remask()
}

type masked struct {
	said string
	err  error
}

func (m masked) Error() string { return m.said }
func (m masked) Unwrap() error { return m.err }
