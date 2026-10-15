package workspace

import (
	"fmt"
	"regexp"
	"strings"
)

// The one way a value enters sh -c: single-quoted, each ' closed, escaped and reopened.
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

var (
	// An environment's name heads its preview's host label, ahead of the cluster's 21 characters.
	envNames = regexp.MustCompile(`^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$`)
	// A service's name is a container's: a DNS-1123 label.
	serviceNames = regexp.MustCompile(`^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`)
	// GitHub's: an owner is 1-39 letters, digits and single inner dashes; a name 1-100 letters, digits and ._-.
	repoNames   = regexp.MustCompile(`^[A-Za-z0-9](-?[A-Za-z0-9])*/[A-Za-z0-9._-]{1,100}$`)
	branchChars = regexp.MustCompile(`^[A-Za-z0-9._/+=@,#-]+$`)
)

const branchRule = "letters, digits and ._/+=@,#-, valid to git check-ref-format --branch"

func validEnvName(name string) error {
	if !envNames.MatchString(name) {
		return fmt.Errorf("name %q: lowercase letters, digits and inner dashes, from a letter, 32 at most", name)
	}
	return nil
}

func validServiceName(name string) error {
	if !serviceNames.MatchString(name) {
		return fmt.Errorf("service name %q: lowercase letters, digits and inner dashes, from a letter, 63 at most", name)
	}
	return nil
}

func validRepo(repo string) error {
	owner, name, _ := strings.Cut(repo, "/")
	if !repoNames.MatchString(repo) || len(owner) > 39 || name == "." || name == ".." {
		return fmt.Errorf("repo %q: owner/name, the owner letters, digits and inner dashes (39 at most), the name letters, digits and ._- (100 at most)", repo)
	}
	return nil
}

func validBranch(branch string) error {
	if !branchChars.MatchString(branch) || !refFormat(branch) {
		return fmt.Errorf("branch %q: %s", branch, branchRule)
	}
	return nil
}

// git check-ref-format --branch, on a name branchChars already holds to ASCII with no control, space, ~^:?*[\.
func refFormat(b string) bool {
	if strings.HasPrefix(b, "-") || b == "HEAD" || b == "@" || strings.HasSuffix(b, ".") ||
		strings.Contains(b, "..") || strings.Contains(b, "@{") {
		return false
	}
	for _, c := range strings.Split(b, "/") {
		if c == "" || strings.HasPrefix(c, ".") || strings.HasSuffix(c, ".lock") {
			return false
		}
	}
	return true
}
