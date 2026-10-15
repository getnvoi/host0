package db

import (
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"

	"github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
	"github.com/ncruces/go-sqlite3/gormlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"

	"github.com/getnvoi/host0/internal/shared/seal"
)

// Rows whose values Inspect searches for: an environment, a session, a secret, a credential and an LLM config.
func rows(t *testing.T, db *gorm.DB) {
	t.Helper()
	a := Agent{Name: "reviewer-agent"}
	must(t, db.Create(&a).Error)
	e := Environment{Name: "checkout-service", Repo: "acme/checkout", Branch: "main"}
	must(t, db.Create(&e).Error)
	must(t, db.Create(&Session{PublicID: "7f3e9a2b", AgentID: a.ID, EnvironmentID: e.ID, State: "idle"}).Error)
	must(t, db.Create(&Secret{EnvironmentID: e.ID, Key: "TOKEN", Value: "ghp_x"}).Error)
	must(t, db.Create(&Credential{Name: "github", Value: "ghp_workspace"}).Error)
	must(t, db.Create(&LLMConfig{Name: "main", Provider: "anthropic", Values: map[string]string{"api_key": "sk-ant-1"}}).Error)
}

func inspect(t *testing.T, db *gorm.DB, path string) AtRest {
	t.Helper()
	r, err := Inspect(db, path)
	must(t, err)
	return r
}

func TestAtRest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "h0.db")
	db := open(t, path, seal.Mint())
	rows(t, db)
	check := func(r AtRest) {
		t.Helper()
		// The schema, the prefix, three sealed values, two names, a repo and a session id.
		if r.Markers != 9 || r.Sealed != 3 {
			t.Errorf("markers %d, sealed %d", r.Markers, r.Sealed)
		}
		if !r.OK || r.Found != 0 || len(r.Plain) != 0 || len(r.Foreign) != 0 || len(r.Unsealed) != 0 {
			t.Errorf("not at rest: %+v", r)
		}
		for _, f := range r.Files {
			if f.Name == "h0.db" && f.Size == 0 {
				t.Errorf("h0.db is empty")
			}
		}
	}
	r := inspect(t, db, path)
	if !slices.ContainsFunc(r.Files, func(f File) bool { return f.Name == "h0.db-wal" && f.Size > 0 }) {
		t.Fatalf("the rows are not in a -wal: %+v", r.Files)
	}
	check(r)
	must(t, db.Exec("PRAGMA wal_checkpoint(TRUNCATE)").Error)
	check(inspect(t, db, path))
}

// A file beside the database and a sealed column holding plaintext each fail it.
func TestAtRestForeignAndUnsealed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "h0.db")
	db := open(t, path, seal.Mint())
	rows(t, db)
	must(t, os.WriteFile(filepath.Join(filepath.Dir(path), "dump.sql"), []byte("x"), 0o600))
	must(t, db.Exec("UPDATE secrets SET value = 'ghp_plain'").Error)
	r := inspect(t, db, path)
	if r.OK || !reflect.DeepEqual(r.Foreign, []string{"dump.sql"}) || !reflect.DeepEqual(r.Unsealed, []string{"secrets.value"}) {
		t.Errorf("%+v", r)
	}
}

// A SQLite file opened without the xts VFS is plaintext: its header and every marker show.
func TestAtRestPlain(t *testing.T) {
	path := filepath.Join(t.TempDir(), "h0.db")
	conn, err := driver.Open("file:"+(&url.URL{Path: path}).EscapedPath(), fts5.Register)
	must(t, err)
	db, err := gorm.Open(gormlite.OpenDB(conn), &gorm.Config{Logger: logger.Discard})
	must(t, err)
	t.Cleanup(func() { closeDB(t, db) })
	must(t, useKey(db, seal.Mint()))
	must(t, Migrate(db))
	rows(t, db)
	r := inspect(t, db, path)
	if r.OK || !reflect.DeepEqual(r.Plain, []string{"h0.db"}) || r.Found != r.Markers {
		t.Errorf("a plain file reads as %+v", r)
	}
}

// sealedColumns is every column the models seal.
func TestSealedColumns(t *testing.T) {
	var got [][2]string
	for _, m := range models {
		s, err := schema.Parse(m, &sync.Map{}, schema.NamingStrategy{})
		must(t, err)
		for _, f := range s.Fields {
			if f.TagSettings["SERIALIZER"] == "sealed" {
				got = append(got, [2]string{s.Table, f.DBName})
			}
		}
	}
	want := slices.Clone(sealedColumns)
	less := func(a, b [2]string) int {
		if a[0]+"."+a[1] < b[0]+"."+b[1] {
			return -1
		}
		return 1
	}
	slices.SortFunc(got, less)
	slices.SortFunc(want, less)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("models seal %v, Inspect reads %v", got, want)
	}
}
