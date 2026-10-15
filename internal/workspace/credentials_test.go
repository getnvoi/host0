package workspace

import (
	"context"
	"errors"
	"testing"
)

// Repositories asks the forge with the GitHub token the workspace holds, and refuses when it holds none.
func TestRepositories(t *testing.T) {
	ws := newWorkspace(t, nil)
	var conflict Conflict
	if _, err := ws.Repositories(context.Background()); !errors.As(err, &conflict) {
		t.Fatalf("no token: %v", err)
	}
	if err := ws.PutCredentials(Credentials{GitHub: "ghu_user"}); err != nil {
		t.Fatal(err)
	}
	rs, err := ws.Repositories(context.Background())
	if err != nil || len(rs) != 1 || rs[0].FullName != "o/r" {
		t.Fatalf("repositories %+v, %v", rs, err)
	}
	if f := ws.Forge.(*forge); len(f.tokens) != 1 || f.tokens[0] != "ghu_user" {
		t.Fatalf("tokens %v", f.tokens)
	}
}
