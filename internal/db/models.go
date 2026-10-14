package db

import (
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
)

// A person in this workspace; AccountID is their account on the hub.
type Member struct {
	ID        uint
	AccountID string `gorm:"not null;uniqueIndex"`
	Login     string `gorm:"not null"`
	Role      string `gorm:"not null"`
	JoinedAt  time.Time
}

type Agent struct {
	ID              uint
	Slug            string `gorm:"not null;uniqueIndex"`
	Name            string `gorm:"not null"`
	Tagline         string
	Instructions    string
	Model           string
	SubagentsAtOnce int        `gorm:"not null;default:4"`
	LLMConfigID     *uint      `gorm:"index"` // nil runs on the main config
	LLMConfig       *LLMConfig `gorm:"constraint:OnDelete:SET NULL"`
	ArchivedAt      *time.Time
	ToolPolicies    []ToolPolicy `gorm:"constraint:OnDelete:CASCADE"`
	Sessions        []Session    `gorm:"constraint:OnDelete:RESTRICT"`
}

type ToolPolicy struct {
	ID      uint
	AgentID uint   `gorm:"not null;uniqueIndex:idx_tool_policies_agent_tool"`
	Tool    string `gorm:"not null;uniqueIndex:idx_tool_policies_agent_tool"`
	Level   string `gorm:"not null"` // auto, approval or deny
}

type LLMConfig struct {
	ID         uint
	Name       string `gorm:"not null;uniqueIndex"`
	Provider   string `gorm:"not null"`
	Kind       string
	Values     map[string]string `gorm:"type:text;serializer:sealed"`
	Main       bool              `gorm:"not null;default:false"`
	ArchivedAt *time.Time
}

type Environment struct {
	ID         uint
	Name       string `gorm:"not null;uniqueIndex"`
	Repo       string `gorm:"not null"` // owner/name
	Branch     string `gorm:"not null"`
	Image      string
	Preview    int // the app's port
	Tier       string
	ArchivedAt *time.Time
	EnvVars    []EnvVar    `gorm:"constraint:OnDelete:CASCADE"`
	Secrets    []Secret    `gorm:"constraint:OnDelete:CASCADE"`
	SetupSteps []SetupStep `gorm:"constraint:OnDelete:CASCADE"`
	Services   []Service   `gorm:"constraint:OnDelete:CASCADE"`
	Seeds      []Seed      `gorm:"constraint:OnDelete:CASCADE"`
	Sessions   []Session   `gorm:"constraint:OnDelete:RESTRICT"`
}

type EnvVar struct {
	ID            uint
	EnvironmentID uint   `gorm:"not null;uniqueIndex:idx_env_vars_env_key"`
	Key           string `gorm:"not null;uniqueIndex:idx_env_vars_env_key"`
	Value         string
}

type Secret struct {
	ID            uint
	EnvironmentID uint   `gorm:"not null;uniqueIndex:idx_secrets_env_key"`
	Key           string `gorm:"not null;uniqueIndex:idx_secrets_env_key"`
	Value         string `gorm:"type:text;serializer:sealed"`
}

type SetupStep struct {
	ID            uint
	EnvironmentID uint   `gorm:"not null;uniqueIndex:idx_setup_steps_env_position"`
	Position      int    `gorm:"not null;uniqueIndex:idx_setup_steps_env_position"`
	Command       string `gorm:"not null"`
}

type Service struct {
	ID            uint
	EnvironmentID uint   `gorm:"not null;uniqueIndex:idx_services_env_name"`
	Name          string `gorm:"not null;uniqueIndex:idx_services_env_name"`
	Image         string // empty runs the environment's
	Command       string
	Port          int
	Early         bool              `gorm:"not null;default:false"` // starts before the checkout is ready
	Env           map[string]string `gorm:"type:text;serializer:json"`
}

type Seed struct {
	ID            uint
	EnvironmentID uint `gorm:"not null;index"`
	Actor         string
	Template      string
	Tag           string
	Spec          string // digest of the containers it was built from
	State         string `gorm:"not null"` // building, ready or failed
	Step          string
	Error         string
	Preview       string
	BuiltAt       *time.Time
}

// DeletedAt hides a session; its events stay, and the foreign key refuses a hard delete while they do.
type Session struct {
	ID             uint
	PublicID       string   `gorm:"not null;uniqueIndex;size:8"` // 8 hex, the id in names
	AgentID        uint     `gorm:"not null;index"`
	EnvironmentID  uint     `gorm:"not null;index"`
	MemberID       *uint    `gorm:"index"` // who started it; nil when no member did
	Member         *Member  `gorm:"constraint:OnDelete:RESTRICT"`
	ParentID       *uint    `gorm:"index"` // the session that spawned this sub-agent
	Parent         *Session `gorm:"constraint:OnDelete:SET NULL"`
	Branch         string
	Preview        string
	Transcript     string // the runner's session id
	Turns          int    `gorm:"not null;default:0"`
	State          string `gorm:"not null"`
	Title          string
	Error          string
	Cursor         int64 `gorm:"not null;default:0"` // bytes of the runner's log already read
	Mark           int   `gorm:"not null;default:0"` // position of the running turn's prompt in events
	Pending        string
	DeletedAt      gorm.DeletedAt  `gorm:"index"`
	Events         []Event         `gorm:"constraint:OnDelete:RESTRICT"`
	QueuedMessages []QueuedMessage `gorm:"constraint:OnDelete:CASCADE"`
	Approvals      []Approval      `gorm:"constraint:OnDelete:CASCADE"`
	Artifacts      []Artifact      `gorm:"constraint:OnDelete:CASCADE"`
	Notes          []Note          `gorm:"constraint:OnDelete:CASCADE"`
}

// Append-only: BeforeUpdate refuses in code and a trigger refuses in the database.
type Event struct {
	ID        uint
	SessionID uint   `gorm:"not null;uniqueIndex:idx_events_session_position"`
	Position  int    `gorm:"not null;uniqueIndex:idx_events_session_position"`
	Kind      string `gorm:"not null"`
	Tool      string
	ToolID    string
	Parent    string // the tool_use id of the sub-agent call it happened inside
	Content   string
	Meta      json.RawMessage `gorm:"type:text;serializer:json"`
	MemberID  *uint           `gorm:"index"` // the author of a prompt
	Member    *Member         `gorm:"constraint:OnDelete:RESTRICT"`
	At        time.Time       `gorm:"not null"`
}

var ErrAppendOnly = errors.New("events are append-only")

func (*Event) BeforeUpdate(*gorm.DB) error { return ErrAppendOnly }

type QueuedMessage struct {
	ID        uint
	SessionID uint    `gorm:"not null;uniqueIndex:idx_queued_messages_session_position"`
	Position  int     `gorm:"not null;uniqueIndex:idx_queued_messages_session_position"`
	Text      string  `gorm:"not null"`
	MemberID  *uint   `gorm:"index"`
	Member    *Member `gorm:"constraint:OnDelete:RESTRICT"`
}

type Approval struct {
	ID          uint
	PublicID    string `gorm:"not null;uniqueIndex"`
	SessionID   uint   `gorm:"not null;index"`
	Turn        int    `gorm:"not null"`
	Tool        string `gorm:"not null"`
	ToolID      string
	Input       json.RawMessage `gorm:"type:text;serializer:json"`
	State       string          `gorm:"not null"`
	Outcome     json.RawMessage `gorm:"type:text;serializer:json"`
	DecidedByID *uint           `gorm:"index"`
	DecidedBy   *Member         `gorm:"constraint:OnDelete:RESTRICT"`
	DecidedAt   *time.Time
}

type Artifact struct {
	ID        uint
	SessionID uint   `gorm:"not null;uniqueIndex:idx_artifacts_session_name"`
	Name      string `gorm:"not null;uniqueIndex:idx_artifacts_session_name"`
	Type      string
	Viewer    string
	Versions  []ArtifactVersion `gorm:"constraint:OnDelete:CASCADE"`
}

// The bytes are not in the database; the row describes them.
type ArtifactVersion struct {
	ID         uint
	ArtifactID uint `gorm:"not null;uniqueIndex:idx_artifact_versions_artifact_number"`
	Number     int  `gorm:"not null;uniqueIndex:idx_artifact_versions_artifact_number"`
	Size       int64
	SHA256     string `gorm:"column:sha256"`
	Note       string
	ToolID     string
	Turn       int
	At         time.Time `gorm:"not null"`
}

type Note struct {
	ID        uint
	SessionID uint `gorm:"not null;index"`
	Position  int  `gorm:"not null"`
	Body      string
	MemberID  *uint   `gorm:"index"`
	Member    *Member `gorm:"constraint:OnDelete:RESTRICT"`
}

type Route struct {
	ID    uint
	Host  string `gorm:"not null;uniqueIndex"`
	Actor string `gorm:"not null"`
}

// Digest is the token's digest; the token itself is not a column.
type SignIn struct {
	ID        uint
	Digest    string `gorm:"not null;uniqueIndex"`
	Kind      string `gorm:"not null"` // link, browser or device
	Label     string
	MemberID  *uint     `gorm:"index"`
	Member    *Member   `gorm:"constraint:OnDelete:CASCADE"`
	ExpiresAt time.Time `gorm:"not null"`
}

// One row, ID 1: what install declares about the workers and sizes. Tiers is the JSON of sandbox.Tier.
type Shape struct {
	ID      uint            `gorm:"check:shape_single,id = 1"`
	Workers Workers         `gorm:"embedded;embeddedPrefix:workers_"`
	Tiers   json.RawMessage `gorm:"type:text;serializer:json"`
}

type Workers struct {
	Type string
	Max  int
	Idle time.Duration // a worker with no actor this long is deleted
}

type UsageHour struct {
	ID          uint
	Hour        time.Time `gorm:"not null;uniqueIndex:idx_usage_hours_hour_tier"` // UTC, truncated to the hour
	Tier        string    `gorm:"not null;uniqueIndex:idx_usage_hours_hour_tier"`
	RunningS    int64     `gorm:"column:running_s;not null;default:0"`
	PausedS     int64     `gorm:"column:paused_s;not null;default:0"`
	SnapshotGBS float64   `gorm:"column:snapshot_gbs;not null;default:0"` // gigabyte-seconds
	ReportedAt  *time.Time
}
