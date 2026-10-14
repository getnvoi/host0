package dns

import (
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
)

// Variables hz already reads under another name.
var known = map[string]map[string]string{
	"CLOUDFLAREAPI": {"apitoken": "CLOUDFLARE_API_TOKEN"},
}

var nonword = regexp.MustCompile(`[^A-Z0-9]+`)

// The shell variable each of the provider's creds.json keys is read from: dnscontrol's own when it names one,
// else <TYPE>_<KEY> uppercased (GANDI_V5_TOKEN, OVH_APP_KEY).
func Vars(provider string) (map[string]string, error) {
	def, err := Provider(provider)
	if err != nil {
		return nil, err
	}
	vars := map[string]string{}
	for _, f := range def.CredFields {
		if f.Internal {
			continue
		}
		v := f.EnvVar
		if v == "" {
			v = nonword.ReplaceAllString(strings.ToUpper(def.TypeName+"_"+f.Key), "_")
		}
		vars[f.Key] = v
	}
	maps.Copy(vars, known[def.TypeName])
	if len(vars) == 0 {
		return nil, fmt.Errorf("dns %s declares no credential keys: name them in the file's dns.credentials", def.TypeName)
	}
	return vars, nil
}

// Reads each key's variable. Every one is required when all is set; otherwise those set are taken, one at least.
func Read(vars map[string]string, getenv func(string) string, all bool) (map[string]string, error) {
	creds := map[string]string{}
	for _, k := range slices.Sorted(maps.Keys(vars)) {
		if v := getenv(vars[k]); v != "" {
			creds[k] = v
		} else if all {
			return nil, fmt.Errorf("%s is not set (credential %s)", vars[k], k)
		}
	}
	if len(creds) == 0 {
		names := slices.Sorted(maps.Values(vars))
		return nil, fmt.Errorf("none of %s is set", strings.Join(names, ", "))
	}
	return creds, nil
}
