package main

import (
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// A person, as GitHub knows them. The hub keeps no GitHub token: the plane of each workspace holds it.
type User struct {
	ID        uint
	GitHubID  int64  `gorm:"not null;uniqueIndex"`
	Login     string `gorm:"not null"`
	Name      string
	AvatarURL string
	Email     string // the primary verified address
	CreatedAt time.Time
}

// A device token, kept as the hex of its sha256.
type Device struct {
	ID        uint
	UserID    uint   `gorm:"not null;index"`
	Hash      string `gorm:"not null;uniqueIndex"`
	CreatedAt time.Time
}

// A sign-in on its way through GitHub: State is the hub's own, sent to GitHub; AppState goes back to the app.
type SignIn struct {
	ID        uint
	State     string `gorm:"not null;uniqueIndex"`
	Challenge string `gorm:"not null"`
	AppState  string `gorm:"not null"`
	Expires   time.Time
}

// A one-time code the app trades, with the verifier of Challenge, for a device token; kept as the hex of its sha256.
type Code struct {
	ID        uint
	Hash      string `gorm:"not null;uniqueIndex"`
	UserID    uint   `gorm:"not null"`
	Challenge string `gorm:"not null"`
	Expires   time.Time
	Used      bool `gorm:"not null;default:false"`
}

// A workspace: a cluster named after it on the hub's cloud, under the hub's zone. Seal is its plane's sealing key and
// Token the plane's API token, both minted by its install.
type Workspace struct {
	ID        uint
	Name      string `gorm:"not null;uniqueIndex"`
	UserID    uint   `gorm:"not null;index"`
	Plan      string `gorm:"not null"`
	Location  string `gorm:"not null"`
	Seal      string `gorm:"type:text;serializer:sealed"`
	Token     string `gorm:"type:text;serializer:sealed"`
	CreatedAt time.Time
	DeletedAt gorm.DeletedAt `gorm:"index"`
}

// An install or a destroy of a workspace; State is running, ok or failed.
type Run struct {
	ID          uint
	WorkspaceID uint   `gorm:"not null;index"`
	Kind        string `gorm:"not null"`
	State       string `gorm:"not null"`
	CreatedAt   time.Time
}

// A line a run printed, N from 0. The last carries the run's end: ok, or failed with the failure's sentence.
type Line struct {
	ID    uint
	RunID uint   `gorm:"not null;uniqueIndex:idx_lines_run_n"`
	N     int    `gorm:"not null;uniqueIndex:idx_lines_run_n"`
	Text  string `gorm:"not null"`
	State string
}

func migrate(db *gorm.DB) error {
	return gormigrate.New(db, &gormigrate.Options{TableName: "migrations", IDColumnName: "id", IDColumnSize: 255,
		UseTransaction: true, ValidateUnknownMigrations: true}, migrations).Migrate()
}

// Frozen: a model that changes gets the next migration.
var migrations = []*gormigrate.Migration{
	{ID: "0001", Migrate: func(tx *gorm.DB) error {
		return tx.Migrator().CreateTable(&m1User{}, &m1Device{}, &m1SignIn{}, &m1Code{}, &m1Workspace{}, &m1Run{}, &m1Line{})
	}},
}

type m1User struct {
	ID        uint
	GitHubID  int64  `gorm:"not null;uniqueIndex"`
	Login     string `gorm:"not null"`
	Name      string
	AvatarURL string
	Email     string
	CreatedAt time.Time
}

func (m1User) TableName() string { return "users" }

type m1Device struct {
	ID        uint
	UserID    uint   `gorm:"not null;index"`
	Hash      string `gorm:"not null;uniqueIndex"`
	CreatedAt time.Time
}

func (m1Device) TableName() string { return "devices" }

type m1SignIn struct {
	ID        uint
	State     string `gorm:"not null;uniqueIndex"`
	Challenge string `gorm:"not null"`
	AppState  string `gorm:"not null"`
	Expires   time.Time
}

func (m1SignIn) TableName() string { return "sign_ins" }

type m1Code struct {
	ID        uint
	Hash      string `gorm:"not null;uniqueIndex"`
	UserID    uint   `gorm:"not null"`
	Challenge string `gorm:"not null"`
	Expires   time.Time
	Used      bool `gorm:"not null;default:false"`
}

func (m1Code) TableName() string { return "codes" }

type m1Workspace struct {
	ID        uint
	Name      string `gorm:"not null;uniqueIndex"`
	UserID    uint   `gorm:"not null;index"`
	Plan      string `gorm:"not null"`
	Location  string `gorm:"not null"`
	Seal      string `gorm:"type:text"`
	Token     string `gorm:"type:text"`
	CreatedAt time.Time
	DeletedAt *time.Time `gorm:"index"`
}

func (m1Workspace) TableName() string { return "workspaces" }

type m1Run struct {
	ID          uint
	WorkspaceID uint   `gorm:"not null;index"`
	Kind        string `gorm:"not null"`
	State       string `gorm:"not null"`
	CreatedAt   time.Time
}

func (m1Run) TableName() string { return "runs" }

type m1Line struct {
	ID    uint
	RunID uint   `gorm:"not null;uniqueIndex:idx_lines_run_n"`
	N     int    `gorm:"not null;uniqueIndex:idx_lines_run_n"`
	Text  string `gorm:"not null"`
	State string
}

func (m1Line) TableName() string { return "lines" }
