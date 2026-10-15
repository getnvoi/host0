package db

import (
	"encoding/json"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func migrator(db *gorm.DB) *gormigrate.Gormigrate {
	return gormigrate.New(db, &gormigrate.Options{
		TableName:                 "migrations",
		IDColumnName:              "id",
		IDColumnSize:              255,
		UseTransaction:            true,
		ValidateUnknownMigrations: true,
	}, migrations)
}

var migrations = []*gormigrate.Migration{
	{ID: "0001", Migrate: migrate0001},
	{ID: "0002", Migrate: migrate0002},
	{ID: "0003", Migrate: migrate0003},
	{ID: "0004", Migrate: migrate0004},
	{ID: "0005", Migrate: migrate0005},
	{ID: "0006", Migrate: migrate0006},
	{ID: "0007", Migrate: migrate0007},
	{ID: "0008", Migrate: migrate0008},
	{ID: "0009", Migrate: migrate0009},
}

// The workspace tables as of 0001, frozen: a model that changes gets a new migration, not an edit here.
func migrate0001(tx *gorm.DB) error {
	if err := tx.Migrator().CreateTable(
		&m1Member{}, &m1LLMConfig{}, &m1Agent{}, &m1ToolPolicy{},
		&m1Environment{}, &m1EnvVar{}, &m1Secret{}, &m1SetupStep{}, &m1Service{}, &m1Seed{},
		&m1Session{}, &m1Event{}, &m1QueuedMessage{}, &m1Approval{}, &m1Artifact{}, &m1ArtifactVersion{}, &m1Note{},
		&m1Route{}, &m1SignIn{}, &m1Shape{}, &m1UsageHour{},
	); err != nil {
		return err
	}
	stmts := []string{`CREATE TRIGGER events_append_only BEFORE UPDATE ON events
		BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`}
	for _, t := range [][2]string{{"events", "content"}, {"notes", "body"}, {"queued_messages", "text"}, {"sessions", "title"}} {
		stmts = append(stmts, m1Search(t[0], t[1])...)
	}
	for _, q := range stmts {
		if err := tx.Exec(q).Error; err != nil {
			return err
		}
	}
	return nil
}

// Tool policies on the environment, until agents hold them.
func migrate0002(tx *gorm.DB) error {
	return tx.Migrator().AddColumn(&m2Environment{}, "Tools")
}

type m2Environment struct {
	Tools string `gorm:"type:text"`
}

func (m2Environment) TableName() string { return "environments" }

// The workspace's own credentials, and when each agent credential was added.
func migrate0003(tx *gorm.DB) error {
	if err := tx.Migrator().AddColumn(&m3LLMConfig{}, "CreatedAt"); err != nil {
		return err
	}
	return tx.Migrator().CreateTable(&m3Credential{})
}

type m3LLMConfig struct {
	CreatedAt time.Time
}

func (m3LLMConfig) TableName() string { return "llm_configs" }

type m3Credential struct {
	ID    uint
	Name  string `gorm:"not null;uniqueIndex"`
	Value string `gorm:"type:text"`
}

func (m3Credential) TableName() string { return "credentials" }

// A seed's setup run, whose log a session reads, and when its build started.
func migrate0004(tx *gorm.DB) error {
	for _, c := range []string{"Run", "StartedAt"} {
		if err := tx.Migrator().AddColumn(&m4Seed{}, c); err != nil {
			return err
		}
	}
	return nil
}

type m4Seed struct {
	Run       string
	StartedAt time.Time
}

func (m4Seed) TableName() string { return "seeds" }

// What a session's turns need of their own: whether its fork was made, the auto tools' outcomes waiting on its
// approvals, when it started and when it last changed.
func migrate0005(tx *gorm.DB) error {
	for _, c := range []string{"Forked", "Outcomes", "StartedAt", "LastAt"} {
		if err := tx.Migrator().AddColumn(&m5Session{}, c); err != nil {
			return err
		}
	}
	return nil
}

type m5Session struct {
	Forked    bool   `gorm:"not null;default:false"`
	Outcomes  string `gorm:"type:text"`
	StartedAt time.Time
	LastAt    time.Time
}

func (m5Session) TableName() string { return "sessions" }

// When an approval was asked for, and the decision while it is carried out.
func migrate0006(tx *gorm.DB) error {
	for _, c := range []string{"AskedAt", "Allow"} {
		if err := tx.Migrator().AddColumn(&m6Approval{}, c); err != nil {
			return err
		}
	}
	return nil
}

type m6Approval struct {
	AskedAt time.Time
	Allow   bool `gorm:"not null;default:false"`
}

func (m6Approval) TableName() string { return "approvals" }

// A route's port and tier, the workers' location, when a sign-in began, and usage per session and per pool.
func migrate0007(tx *gorm.DB) error {
	m := tx.Migrator()
	for _, c := range []struct {
		model any
		field string
	}{{&m7Route{}, "Port"}, {&m7Route{}, "Tier"}, {&m7Shape{}, "WorkersLocation"}, {&m7SignIn{}, "CreatedAt"},
		{&m7UsageHour{}, "Session"}, {&m7UsageHour{}, "Env"}, {&m7UsageHour{}, "By"}, {&m7UsageHour{}, "SuspendedS"},
		{&m7UsageHour{}, "WorkerS"}} {
		if err := m.AddColumn(c.model, c.field); err != nil {
			return err
		}
	}
	if err := m.DropIndex(&m7UsageHour{}, "idx_usage_hours_hour_tier"); err != nil {
		return err
	}
	return m.CreateIndex(&m7UsageHour{}, "idx_usage_hours_hour_tier_session")
}

type m7Route struct {
	Port int
	Tier string
}

type m7Shape struct {
	WorkersLocation string
}

type m7SignIn struct {
	CreatedAt time.Time
}

type m7UsageHour struct {
	Hour       time.Time `gorm:"not null;uniqueIndex:idx_usage_hours_hour_tier_session"`
	Tier       string    `gorm:"not null;uniqueIndex:idx_usage_hours_hour_tier_session"`
	Session    string    `gorm:"not null;default:'';uniqueIndex:idx_usage_hours_hour_tier_session"`
	Env        string
	By         string
	SuspendedS int64 `gorm:"column:suspended_s;not null;default:0"`
	WorkerS    int64 `gorm:"column:worker_s;not null;default:0"`
}

func (m7Route) TableName() string     { return "routes" }
func (m7Shape) TableName() string     { return "shapes" }
func (m7SignIn) TableName() string    { return "sign_ins" }
func (m7UsageHour) TableName() string { return "usage_hours" }

// When an idle actor is paused and suspended; a shape written before keeps 10 and 60 minutes.
func migrate0008(tx *gorm.DB) error {
	for _, f := range []string{"ActorsPause", "ActorsSuspend"} {
		if err := tx.Migrator().AddColumn(&m8Shape{}, f); err != nil {
			return err
		}
	}
	return nil
}

type m8Shape struct {
	ActorsPause   time.Duration `gorm:"not null;default:600000000000"`
	ActorsSuspend time.Duration `gorm:"not null;default:3600000000000"`
}

func (m8Shape) TableName() string { return "shapes" }

// Tool policies leave the environment: each agent holds its own.
func migrate0009(tx *gorm.DB) error {
	// SQLite drops the column in place; the Migrator's DropColumn remakes the table and loses its indexes.
	return tx.Exec("ALTER TABLE environments DROP COLUMN tools").Error
}

// An FTS5 index <table>_fts over one column, its rowid the row's id, kept in step by triggers.
func m1Search(table, col string) []string {
	fts := table + "_fts"
	del := "INSERT INTO " + fts + "(" + fts + ", rowid, " + col + ") VALUES ('delete', old.id, old." + col + ");"
	add := "INSERT INTO " + fts + "(rowid, " + col + ") VALUES (new.id, new." + col + ");"
	return []string{
		"CREATE VIRTUAL TABLE " + fts + " USING fts5(" + col + ", content='" + table + "', content_rowid='id')",
		"CREATE TRIGGER " + fts + "_insert AFTER INSERT ON " + table + " BEGIN " + add + " END",
		"CREATE TRIGGER " + fts + "_delete AFTER DELETE ON " + table + " BEGIN " + del + " END",
		"CREATE TRIGGER " + fts + "_update AFTER UPDATE OF " + col + " ON " + table + " BEGIN " + del + " " + add + " END",
	}
}

type m1Member struct {
	ID        uint
	AccountID string `gorm:"not null;uniqueIndex"`
	Login     string `gorm:"not null"`
	Role      string `gorm:"not null"`
	JoinedAt  time.Time
}

type m1Agent struct {
	ID              uint
	Slug            string `gorm:"not null;uniqueIndex"`
	Name            string `gorm:"not null"`
	Tagline         string
	Instructions    string
	Model           string
	SubagentsAtOnce int          `gorm:"not null;default:4"`
	LLMConfigID     *uint        `gorm:"index"`
	LLMConfig       *m1LLMConfig `gorm:"constraint:OnDelete:SET NULL"`
	ArchivedAt      *time.Time
}

type m1ToolPolicy struct {
	ID      uint
	AgentID uint     `gorm:"not null;uniqueIndex:idx_tool_policies_agent_tool"`
	Agent   *m1Agent `gorm:"constraint:OnDelete:CASCADE"`
	Tool    string   `gorm:"not null;uniqueIndex:idx_tool_policies_agent_tool"`
	Level   string   `gorm:"not null"`
}

type m1LLMConfig struct {
	ID         uint
	Name       string `gorm:"not null;uniqueIndex"`
	Provider   string `gorm:"not null"`
	Kind       string
	Values     string `gorm:"type:text"`
	Main       bool   `gorm:"not null;default:false"`
	ArchivedAt *time.Time
}

type m1Environment struct {
	ID         uint
	Name       string `gorm:"not null;uniqueIndex"`
	Repo       string `gorm:"not null"`
	Branch     string `gorm:"not null"`
	Image      string
	Preview    int
	Tier       string
	ArchivedAt *time.Time
}

type m1EnvVar struct {
	ID            uint
	EnvironmentID uint           `gorm:"not null;uniqueIndex:idx_env_vars_env_key"`
	Environment   *m1Environment `gorm:"constraint:OnDelete:CASCADE"`
	Key           string         `gorm:"not null;uniqueIndex:idx_env_vars_env_key"`
	Value         string
}

type m1Secret struct {
	ID            uint
	EnvironmentID uint           `gorm:"not null;uniqueIndex:idx_secrets_env_key"`
	Environment   *m1Environment `gorm:"constraint:OnDelete:CASCADE"`
	Key           string         `gorm:"not null;uniqueIndex:idx_secrets_env_key"`
	Value         string         `gorm:"type:text"`
}

type m1SetupStep struct {
	ID            uint
	EnvironmentID uint           `gorm:"not null;uniqueIndex:idx_setup_steps_env_position"`
	Environment   *m1Environment `gorm:"constraint:OnDelete:CASCADE"`
	Position      int            `gorm:"not null;uniqueIndex:idx_setup_steps_env_position"`
	Command       string         `gorm:"not null"`
}

type m1Service struct {
	ID            uint
	EnvironmentID uint           `gorm:"not null;uniqueIndex:idx_services_env_name"`
	Environment   *m1Environment `gorm:"constraint:OnDelete:CASCADE"`
	Name          string         `gorm:"not null;uniqueIndex:idx_services_env_name"`
	Image         string
	Command       string
	Port          int
	Early         bool   `gorm:"not null;default:false"`
	Env           string `gorm:"type:text"`
}

type m1Seed struct {
	ID            uint
	EnvironmentID uint           `gorm:"not null;index"`
	Environment   *m1Environment `gorm:"constraint:OnDelete:CASCADE"`
	Actor         string
	Template      string
	Tag           string
	Spec          string
	State         string `gorm:"not null"`
	Step          string
	Error         string
	Preview       string
	BuiltAt       *time.Time
}

type m1Session struct {
	ID            uint
	PublicID      string         `gorm:"not null;uniqueIndex;size:8"`
	AgentID       uint           `gorm:"not null;index"`
	Agent         *m1Agent       `gorm:"constraint:OnDelete:RESTRICT"`
	EnvironmentID uint           `gorm:"not null;index"`
	Environment   *m1Environment `gorm:"constraint:OnDelete:RESTRICT"`
	MemberID      *uint          `gorm:"index"`
	Member        *m1Member      `gorm:"constraint:OnDelete:RESTRICT"`
	ParentID      *uint          `gorm:"index"`
	Parent        *m1Session     `gorm:"constraint:OnDelete:SET NULL"`
	Branch        string
	Preview       string
	Transcript    string
	Turns         int    `gorm:"not null;default:0"`
	State         string `gorm:"not null"`
	Title         string
	Error         string
	Cursor        int64 `gorm:"not null;default:0"`
	Mark          int   `gorm:"not null;default:0"`
	Pending       string
	DeletedAt     gorm.DeletedAt `gorm:"index"`
}

type m1Event struct {
	ID        uint
	SessionID uint       `gorm:"not null;uniqueIndex:idx_events_session_position"`
	Session   *m1Session `gorm:"constraint:OnDelete:RESTRICT"`
	Position  int        `gorm:"not null;uniqueIndex:idx_events_session_position"`
	Kind      string     `gorm:"not null"`
	Tool      string
	ToolID    string
	Parent    string
	Content   string
	Meta      json.RawMessage `gorm:"type:text"`
	MemberID  *uint           `gorm:"index"`
	Member    *m1Member       `gorm:"constraint:OnDelete:RESTRICT"`
	At        time.Time       `gorm:"not null"`
}

type m1QueuedMessage struct {
	ID        uint
	SessionID uint       `gorm:"not null;uniqueIndex:idx_queued_messages_session_position"`
	Session   *m1Session `gorm:"constraint:OnDelete:CASCADE"`
	Position  int        `gorm:"not null;uniqueIndex:idx_queued_messages_session_position"`
	Text      string     `gorm:"not null"`
	MemberID  *uint      `gorm:"index"`
	Member    *m1Member  `gorm:"constraint:OnDelete:RESTRICT"`
}

type m1Approval struct {
	ID          uint
	PublicID    string     `gorm:"not null;uniqueIndex"`
	SessionID   uint       `gorm:"not null;index"`
	Session     *m1Session `gorm:"constraint:OnDelete:CASCADE"`
	Turn        int        `gorm:"not null"`
	Tool        string     `gorm:"not null"`
	ToolID      string
	Input       json.RawMessage `gorm:"type:text"`
	State       string          `gorm:"not null"`
	Outcome     json.RawMessage `gorm:"type:text"`
	DecidedByID *uint           `gorm:"index"`
	DecidedBy   *m1Member       `gorm:"constraint:OnDelete:RESTRICT"`
	DecidedAt   *time.Time
}

type m1Artifact struct {
	ID        uint
	SessionID uint       `gorm:"not null;uniqueIndex:idx_artifacts_session_name"`
	Session   *m1Session `gorm:"constraint:OnDelete:CASCADE"`
	Name      string     `gorm:"not null;uniqueIndex:idx_artifacts_session_name"`
	Type      string
	Viewer    string
}

type m1ArtifactVersion struct {
	ID         uint
	ArtifactID uint        `gorm:"not null;uniqueIndex:idx_artifact_versions_artifact_number"`
	Artifact   *m1Artifact `gorm:"constraint:OnDelete:CASCADE"`
	Number     int         `gorm:"not null;uniqueIndex:idx_artifact_versions_artifact_number"`
	Size       int64
	SHA256     string `gorm:"column:sha256"`
	Note       string
	ToolID     string
	Turn       int
	At         time.Time `gorm:"not null"`
}

type m1Note struct {
	ID        uint
	SessionID uint       `gorm:"not null;index"`
	Session   *m1Session `gorm:"constraint:OnDelete:CASCADE"`
	Position  int        `gorm:"not null"`
	Body      string
	MemberID  *uint     `gorm:"index"`
	Member    *m1Member `gorm:"constraint:OnDelete:RESTRICT"`
}

type m1Route struct {
	ID    uint
	Host  string `gorm:"not null;uniqueIndex"`
	Actor string `gorm:"not null"`
}

type m1SignIn struct {
	ID        uint
	Digest    string `gorm:"not null;uniqueIndex"`
	Kind      string `gorm:"not null"`
	Label     string
	MemberID  *uint     `gorm:"index"`
	Member    *m1Member `gorm:"constraint:OnDelete:CASCADE"`
	ExpiresAt time.Time `gorm:"not null"`
}

type m1Shape struct {
	ID          uint `gorm:"check:shape_single,id = 1"`
	WorkersType string
	WorkersMax  int
	WorkersIdle int64
	Tiers       string `gorm:"type:text"`
}

type m1UsageHour struct {
	ID          uint
	Hour        time.Time `gorm:"not null;uniqueIndex:idx_usage_hours_hour_tier"`
	Tier        string    `gorm:"not null;uniqueIndex:idx_usage_hours_hour_tier"`
	RunningS    int64     `gorm:"column:running_s;not null;default:0"`
	PausedS     int64     `gorm:"column:paused_s;not null;default:0"`
	SnapshotGBS float64   `gorm:"column:snapshot_gbs;not null;default:0"`
	ReportedAt  *time.Time
}

func (m1Member) TableName() string          { return "members" }
func (m1Agent) TableName() string           { return "agents" }
func (m1ToolPolicy) TableName() string      { return "tool_policies" }
func (m1LLMConfig) TableName() string       { return "llm_configs" }
func (m1Environment) TableName() string     { return "environments" }
func (m1EnvVar) TableName() string          { return "env_vars" }
func (m1Secret) TableName() string          { return "secrets" }
func (m1SetupStep) TableName() string       { return "setup_steps" }
func (m1Service) TableName() string         { return "services" }
func (m1Seed) TableName() string            { return "seeds" }
func (m1Session) TableName() string         { return "sessions" }
func (m1Event) TableName() string           { return "events" }
func (m1QueuedMessage) TableName() string   { return "queued_messages" }
func (m1Approval) TableName() string        { return "approvals" }
func (m1Artifact) TableName() string        { return "artifacts" }
func (m1ArtifactVersion) TableName() string { return "artifact_versions" }
func (m1Note) TableName() string            { return "notes" }
func (m1Route) TableName() string           { return "routes" }
func (m1SignIn) TableName() string          { return "sign_ins" }
func (m1Shape) TableName() string           { return "shapes" }
func (m1UsageHour) TableName() string       { return "usage_hours" }
