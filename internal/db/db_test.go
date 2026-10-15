package db

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/shared/seal"
)

func open(t *testing.T, path string, key []byte) *gorm.DB {
	t.Helper()
	db, err := Open(path, key)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeDB(t, db) })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func closeDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	s, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// An agent, an environment and a session in it.
func session(t *testing.T, db *gorm.DB) (Agent, Environment, Session) {
	t.Helper()
	a := Agent{Name: "dev"}
	must(t, db.Create(&a).Error)
	e := Environment{Name: "app", Repo: "o/app", Branch: "main"}
	must(t, db.Create(&e).Error)
	s := Session{PublicID: "0a1b2c3d", AgentID: a.ID, EnvironmentID: e.ID, State: "idle"}
	must(t, db.Create(&s).Error)
	return a, e, s
}

type column struct {
	Name, Type string
	NotNull    bool
	Default    string
	PK         bool
}

type foreign struct{ From, Table, To, OnDelete string }

type table struct {
	Columns []column
	Uniques map[string]string // index name to its columns
	Foreign []foreign
}

// The schema as SQLite reports it, table by table.
func describe(t *testing.T, db *gorm.DB) map[string]table {
	t.Helper()
	var names []string
	must(t, db.Raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' AND name NOT LIKE '%_fts%'`).Scan(&names).Error)
	out := map[string]table{}
	for _, n := range names {
		var tb table
		rows, err := db.Raw(`SELECT name, type, "notnull", COALESCE(dflt_value, ''), pk FROM pragma_table_info(?)`, n).Rows()
		must(t, err)
		for rows.Next() {
			var c column
			must(t, rows.Scan(&c.Name, &c.Type, &c.NotNull, &c.Default, &c.PK))
			tb.Columns = append(tb.Columns, c)
		}
		must(t, rows.Close())
		var idx []struct {
			Name   string
			Unique bool
		}
		must(t, db.Raw(`SELECT name, "unique" FROM pragma_index_list(?)`, n).Scan(&idx).Error)
		tb.Uniques = map[string]string{}
		for _, i := range idx {
			if !i.Unique {
				continue
			}
			var cols []string
			must(t, db.Raw(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, i.Name).Scan(&cols).Error)
			tb.Uniques[i.Name] = strings.Join(cols, ",")
		}
		must(t, db.Raw(`SELECT "from", "table", "to", on_delete AS on_delete FROM pragma_foreign_key_list(?) ORDER BY "from"`, n).Scan(&tb.Foreign).Error)
		out[n] = tb
	}
	return out
}

func TestMigrate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hz.db")
	db := open(t, path, seal.Mint())
	before := describe(t, db)
	must(t, Migrate(db))
	if after := describe(t, db); !reflect.DeepEqual(before, after) {
		t.Fatal("a second Migrate changed the schema")
	}
	var ran []string
	must(t, db.Raw("SELECT id FROM migrations").Scan(&ran).Error)
	if !reflect.DeepEqual(ran, []string{"0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"}) {
		t.Fatalf("migrations recorded: %v", ran)
	}

	tables := []string{"members", "agents", "tool_policies", "llm_configs", "environments", "env_vars", "secrets",
		"setup_steps", "services", "seeds", "sessions", "events", "queued_messages", "approvals", "artifacts",
		"artifact_versions", "notes", "routes", "sign_ins", "shapes", "usage_hours", "credentials"}
	if len(before) != len(tables) {
		t.Errorf("%d tables, want %d", len(before), len(tables))
	}
	for _, n := range tables {
		if _, ok := before[n]; !ok {
			t.Errorf("no table %s", n)
		}
	}

	uniques := map[string]string{
		"members": "account_id", "agents": "name", "tool_policies": "agent_id,tool", "llm_configs": "name",
		"environments": "name", "env_vars": "environment_id,key", "secrets": "environment_id,key",
		"setup_steps": "environment_id,position", "services": "environment_id,name", "sessions": "public_id",
		"events": "session_id,position", "queued_messages": "session_id,position", "approvals": "public_id",
		"artifacts": "session_id,name", "artifact_versions": "artifact_id,number", "routes": "host",
		"sign_ins": "digest", "usage_hours": "hour,tier,session", "credentials": "name",
	}
	for n, cols := range uniques {
		found := false
		for _, c := range before[n].Uniques {
			found = found || c == cols
		}
		if !found {
			t.Errorf("%s has no unique index on (%s): %v", n, cols, before[n].Uniques)
		}
	}

	fks := map[string][]foreign{
		"agents":            {{"llm_config_id", "llm_configs", "id", "SET NULL"}},
		"tool_policies":     {{"agent_id", "agents", "id", "CASCADE"}},
		"env_vars":          {{"environment_id", "environments", "id", "CASCADE"}},
		"secrets":           {{"environment_id", "environments", "id", "CASCADE"}},
		"setup_steps":       {{"environment_id", "environments", "id", "CASCADE"}},
		"services":          {{"environment_id", "environments", "id", "CASCADE"}},
		"seeds":             {{"environment_id", "environments", "id", "CASCADE"}},
		"sessions":          {{"agent_id", "agents", "id", "RESTRICT"}, {"environment_id", "environments", "id", "RESTRICT"}, {"member_id", "members", "id", "RESTRICT"}, {"parent_id", "sessions", "id", "SET NULL"}},
		"events":            {{"member_id", "members", "id", "RESTRICT"}, {"session_id", "sessions", "id", "RESTRICT"}},
		"queued_messages":   {{"member_id", "members", "id", "RESTRICT"}, {"session_id", "sessions", "id", "CASCADE"}},
		"approvals":         {{"decided_by_id", "members", "id", "RESTRICT"}, {"session_id", "sessions", "id", "CASCADE"}},
		"artifacts":         {{"session_id", "sessions", "id", "CASCADE"}},
		"artifact_versions": {{"artifact_id", "artifacts", "id", "CASCADE"}},
		"notes":             {{"member_id", "members", "id", "RESTRICT"}, {"session_id", "sessions", "id", "CASCADE"}},
		"sign_ins":          {{"member_id", "members", "id", "CASCADE"}},
	}
	for _, n := range tables {
		if got := before[n].Foreign; !reflect.DeepEqual(got, fks[n]) {
			t.Errorf("%s foreign keys %v, want %v", n, got, fks[n])
		}
	}

	var trigger int
	must(t, db.Raw(`SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'events_append_only'`).Scan(&trigger).Error)
	if trigger != 1 {
		t.Error("no events_append_only trigger")
	}
	for _, fts := range []string{"events_fts", "notes_fts", "queued_messages_fts", "sessions_fts"} {
		var n int
		must(t, db.Raw(`SELECT count(*) FROM sqlite_master WHERE (type = 'table' AND name = ? AND sql LIKE 'CREATE VIRTUAL TABLE%fts5%')
			OR (type = 'trigger' AND name IN (? || '_insert', ? || '_delete', ? || '_update'))`, fts, fts, fts, fts).Scan(&n).Error)
		if n != 4 {
			t.Errorf("%s: %d of its table and three triggers", fts, n)
		}
	}
}

// The models are what 0001 created; a model that drifts needs a new migration.
func TestModelsMatchMigration(t *testing.T) {
	dir := t.TempDir()
	migrated := open(t, filepath.Join(dir, "a.db"), seal.Mint())
	auto, err := Open(filepath.Join(dir, "b.db"), seal.Mint())
	must(t, err)
	t.Cleanup(func() { closeDB(t, auto) })
	must(t, auto.AutoMigrate(&Member{}, &LLMConfig{}, &Agent{}, &ToolPolicy{}, &Environment{}, &EnvVar{}, &Secret{},
		&SetupStep{}, &Service{}, &Seed{}, &Session{}, &Event{}, &QueuedMessage{}, &Approval{}, &Artifact{},
		&ArtifactVersion{}, &Note{}, &Route{}, &SignIn{}, &Shape{}, &UsageHour{}, &Credential{}))
	want, got := describe(t, migrated), describe(t, auto)
	for n := range want {
		if !reflect.DeepEqual(want[n], got[n]) {
			t.Errorf("%s:\n migration %+v\n models    %+v", n, want[n], got[n])
		}
	}
	if len(got) != len(want) {
		t.Errorf("models make %d tables, the migration %d", len(got), len(want))
	}
}

func TestSealedRoundTrip(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	_, e, _ := session(t, db)
	c := LLMConfig{Name: "main", Provider: "anthropic", Values: map[string]string{"api_key": "sk-ant-1"}, Main: true}
	must(t, db.Create(&c).Error)
	sec := Secret{EnvironmentID: e.ID, Key: "TOKEN", Value: "ghp_x"}
	must(t, db.Create(&sec).Error)

	var c2 LLMConfig
	must(t, db.First(&c2, c.ID).Error)
	if c2.Values["api_key"] != "sk-ant-1" {
		t.Errorf("values %v", c2.Values)
	}
	var sec2 Secret
	must(t, db.First(&sec2, sec.ID).Error)
	if sec2.Value != "ghp_x" {
		t.Errorf("secret %q", sec2.Value)
	}
}

// A plain dump, through SQL with the file key, shows the sealed form of a secret and never the secret.
func TestSealedInDump(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	_, e, _ := session(t, db)
	must(t, db.Create(&Secret{EnvironmentID: e.ID, Key: "TOKEN", Value: "ghp_x"}).Error)
	must(t, db.Create(&LLMConfig{Name: "main", Provider: "anthropic", Values: map[string]string{"api_key": "sk-ant-1"}}).Error)
	var dump []string
	must(t, db.Raw("SELECT value FROM secrets UNION ALL SELECT \"values\" FROM llm_configs").Scan(&dump).Error)
	for _, v := range dump {
		if !strings.HasPrefix(v, "hz-sealed:1:") || strings.Contains(v, "ghp_x") || strings.Contains(v, "sk-ant-1") {
			t.Errorf("dumped %q", v)
		}
	}
}

// A sealed value that does not open names its table and column, and reads as nothing.
func TestSealedForeignValue(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	_, e, _ := session(t, db)
	sec := Secret{EnvironmentID: e.ID, Key: "TOKEN", Value: "ghp_x"}
	must(t, db.Create(&sec).Error)
	foreign, err := seal.Seal(seal.Mint(), []byte("ghp_y"))
	must(t, err)
	must(t, db.Exec("UPDATE secrets SET value = ? WHERE id = ?", string(foreign), sec.ID).Error)
	var s Secret
	err = db.First(&s, sec.ID).Error
	if !errors.Is(err, seal.ErrOpen) || !strings.Contains(err.Error(), "secrets.value") {
		t.Fatalf("read a value sealed under another key: %v", err)
	}
	if s.Value != "" {
		t.Fatalf("a value that does not open read as %q", s.Value)
	}
}

func TestEncryptedAtRest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hz.db")
	db := open(t, path, seal.Mint())
	_, _, s := session(t, db)
	const marker = "CONVERSATION_MARKER_9c1e"
	ev := Event{SessionID: s.ID, Position: 0, Kind: "message", Content: "the build says " + marker, At: time.Now()}
	must(t, db.Create(&ev).Error)
	must(t, db.Create(&Note{SessionID: s.ID, Position: 0, Body: marker}).Error)

	for _, p := range []string{path, path + "-wal"} {
		b, err := os.ReadFile(p)
		must(t, err)
		if len(b) == 0 {
			t.Fatalf("%s is empty", p)
		}
		if bytes.Contains(b, []byte(marker)) || bytes.Contains(b, []byte("SQLite format 3")) {
			t.Errorf("%s holds plaintext", p)
		}
	}

	var got Event
	must(t, db.First(&got, ev.ID).Error)
	if got.Content != ev.Content {
		t.Errorf("read back %q", got.Content)
	}
}

func TestFTS5(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	var opts []string
	must(t, db.Raw("PRAGMA compile_options").Scan(&opts).Error)
	var mods []string
	must(t, db.Raw("SELECT name FROM pragma_module_list WHERE name = 'fts5'").Scan(&mods).Error)
	if len(mods) != 1 {
		t.Fatalf("no fts5 module; compile options %v", opts)
	}

	_, _, s := session(t, db)
	const marker = "zebracrossing"
	ev := Event{SessionID: s.ID, Position: 0, Kind: "message", Content: "deploy failed at " + marker, At: time.Now()}
	must(t, db.Create(&ev).Error)
	must(t, db.Create(&Event{SessionID: s.ID, Position: 1, Kind: "message", Content: "unrelated", At: time.Now()}).Error)
	must(t, db.Create(&Note{SessionID: s.ID, Position: 0, Body: "see " + marker}).Error)
	q := QueuedMessage{SessionID: s.ID, Position: 0, Text: "retry " + marker}
	must(t, db.Create(&q).Error)
	must(t, db.Model(&s).Update("title", "fix "+marker).Error)

	match := func(table string) []uint {
		var ids []uint
		must(t, db.Raw("SELECT rowid FROM "+table+"_fts WHERE "+table+"_fts MATCH ? ORDER BY rowid", marker).Scan(&ids).Error)
		return ids
	}
	if got := match("events"); !reflect.DeepEqual(got, []uint{ev.ID}) {
		t.Errorf("events matching: %v, want [%d]", got, ev.ID)
	}
	for _, table := range []string{"notes", "queued_messages", "sessions"} {
		if got := match(table); len(got) != 1 {
			t.Errorf("%s matching: %v", table, got)
		}
	}

	must(t, db.Model(&s).Update("title", "renamed").Error)
	must(t, db.Delete(&q).Error)
	for _, table := range []string{"sessions", "queued_messages"} {
		if got := match(table); len(got) != 0 {
			t.Errorf("%s still match after the change: %v", table, got)
		}
	}
}

func TestWrongKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hz.db")
	db, err := Open(path, seal.Mint())
	must(t, err)
	must(t, Migrate(db))
	session(t, db)
	closeDB(t, db)

	_, err = Open(path, seal.Mint())
	if err == nil || !strings.Contains(err.Error(), "does not open with this sealing key") {
		t.Fatalf("opened under another key: %v", err)
	}
	if _, err := Open(path, make([]byte, 16)); err == nil {
		t.Fatal("opened with a 16-byte key")
	}
}

func TestUnique(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	a, e, s := session(t, db)
	for _, c := range []struct {
		first, second any
		want          string
	}{
		{&Member{AccountID: "acc1", Login: "a", Role: "admin"}, &Member{AccountID: "acc1", Login: "b", Role: "member"}, "members.account_id"},
		{&EnvVar{EnvironmentID: e.ID, Key: "K"}, &EnvVar{EnvironmentID: e.ID, Key: "K"}, "env_vars.environment_id, env_vars.key"},
		{&ToolPolicy{AgentID: a.ID, Tool: "Bash", Level: "auto"}, &ToolPolicy{AgentID: a.ID, Tool: "Bash", Level: "deny"}, "tool_policies.agent_id, tool_policies.tool"},
		{&Event{SessionID: s.ID, Position: 0, Kind: "status", At: time.Now()}, &Event{SessionID: s.ID, Position: 0, Kind: "status", At: time.Now()}, "events.session_id, events.position"},
		{&Route{Host: "x.example", Actor: "a"}, &Route{Host: "x.example", Actor: "b"}, "routes.host"},
		{&Shape{ID: 1}, &Shape{ID: 2}, "shape_single"},
	} {
		must(t, db.Create(c.first).Error)
		err := db.Create(c.second).Error
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("second %T: %v, want %q", c.second, err, c.want)
		}
	}
}

func count(t *testing.T, db *gorm.DB, model any) int64 {
	t.Helper()
	var n int64
	must(t, db.Unscoped().Model(model).Count(&n).Error)
	return n
}

func TestCascade(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	a, e, s := session(t, db)
	must(t, db.Create(&ToolPolicy{AgentID: a.ID, Tool: "Bash", Level: "auto"}).Error)
	art := Artifact{SessionID: s.ID, Name: "report"}
	must(t, db.Create(&art).Error)
	must(t, db.Create(&ArtifactVersion{ArtifactID: art.ID, Number: 1, At: time.Now()}).Error)
	must(t, db.Create(&EnvVar{EnvironmentID: e.ID, Key: "K"}).Error)
	must(t, db.Create(&Secret{EnvironmentID: e.ID, Key: "S", Value: "v"}).Error)
	must(t, db.Create(&SetupStep{EnvironmentID: e.ID, Position: 0, Command: "make"}).Error)
	must(t, db.Create(&Service{EnvironmentID: e.ID, Name: "db"}).Error)
	must(t, db.Create(&Seed{EnvironmentID: e.ID, State: "ready"}).Error)

	if err := db.Delete(&Environment{}, e.ID).Error; err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
		t.Fatalf("deleted an environment that has a session: %v", err)
	}
	must(t, db.Delete(&art).Error)
	if n := count(t, db, &ArtifactVersion{}); n != 0 {
		t.Errorf("%d artifact versions outlive their artifact", n)
	}
	must(t, db.Unscoped().Delete(&s).Error)
	must(t, db.Delete(&Environment{}, e.ID).Error)
	for _, m := range []any{&EnvVar{}, &Secret{}, &SetupStep{}, &Service{}, &Seed{}} {
		if n := count(t, db, m); n != 0 {
			t.Errorf("%d %T outlive their environment", n, m)
		}
	}
	must(t, db.Delete(&a).Error)
	if n := count(t, db, &ToolPolicy{}); n != 0 {
		t.Errorf("%d tool policies outlive their agent", n)
	}
}

func TestSessionSoftDeleteKeepsEvents(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	_, _, s := session(t, db)
	must(t, db.Create(&Event{SessionID: s.ID, Position: 0, Kind: "prompt", Content: "hi", At: time.Now()}).Error)
	must(t, db.Delete(&s).Error)
	if err := db.First(&Session{}, s.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("a deleted session is found: %v", err)
	}
	if n := count(t, db, &Event{}); n != 1 {
		t.Fatalf("%d events after the session's soft delete", n)
	}
	if err := db.Unscoped().Delete(&s).Error; err == nil || !strings.Contains(err.Error(), "FOREIGN KEY") {
		t.Fatalf("hard-deleted a session that has events: %v", err)
	}
}

func TestEventAppendOnly(t *testing.T) {
	db := open(t, filepath.Join(t.TempDir(), "hz.db"), seal.Mint())
	_, _, s := session(t, db)
	ev := Event{SessionID: s.ID, Position: 0, Kind: "prompt", Content: "hi", At: time.Now()}
	must(t, db.Create(&ev).Error)
	ev.Content = "changed"
	if err := db.Save(&ev).Error; !errors.Is(err, ErrAppendOnly) {
		t.Errorf("Save: %v", err)
	}
	if err := db.Model(&ev).Update("kind", "message").Error; !errors.Is(err, ErrAppendOnly) {
		t.Errorf("Update: %v", err)
	}
	if err := db.Model(&ev).UpdateColumn("kind", "message").Error; err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Errorf("UpdateColumn, which skips hooks: %v", err)
	}
	if err := db.Exec("UPDATE events SET kind = 'x'").Error; err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Errorf("raw UPDATE: %v", err)
	}
	var got Event
	must(t, db.First(&got, ev.ID).Error)
	if got.Content != "hi" || got.Kind != "prompt" {
		t.Errorf("event became %+v", got)
	}
}
