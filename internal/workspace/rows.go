package workspace

import (
	"bytes"
	"cmp"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/llm"
)

// The agent every session runs as until a workspace has agents of its own.
const agentName = "h0"

func rowOf(tx *gorm.DB, sid string) (db.Session, error) {
	var r db.Session
	err := tx.Where("public_id = ?", sid).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r, NotFound{fmt.Errorf("no session %s", sid)}
	}
	return r, err
}

// The member a label names, made the first time it is seen; nil for no label.
func member(tx *gorm.DB, login string) (*uint, error) {
	if login == "" {
		return nil, nil
	}
	m := db.Member{AccountID: "local:" + login}
	if err := tx.Where(&m).Attrs(db.Member{Login: login, Role: "operator", JoinedAt: time.Now()}).FirstOrCreate(&m).Error; err != nil {
		return nil, err
	}
	return &m.ID, nil
}

// The label of the member with id, empty for none.
func login(tx *gorm.DB, id *uint) (string, error) {
	if id == nil {
		return "", nil
	}
	var m db.Member
	err := tx.First(&m, *id).Error
	return m.Login, err
}

// The session and its events.
func (ws *Workspace) Session(sid string) (Session, error) { return ws.load(sid) }

// The session from its rows: its record and its events in order. A removed session is not found.
func (ws *Workspace) load(sid string) (Session, error) {
	r, err := rowOf(ws.DB, sid)
	if err != nil {
		return Session{}, err
	}
	return ws.session(ws.DB, r, true)
}

func (ws *Workspace) session(tx *gorm.DB, r db.Session, events bool) (Session, error) {
	var env db.Environment
	if err := tx.First(&env, r.EnvironmentID).Error; err != nil {
		return Session{}, fmt.Errorf("session %s: its environment: %w", r.PublicID, err)
	}
	by, err := login(tx, r.MemberID)
	if err != nil {
		return Session{}, fmt.Errorf("session %s: who started it: %w", r.PublicID, err)
	}
	var agent db.Agent
	if err := tx.First(&agent, r.AgentID).Error; err != nil {
		return Session{}, fmt.Errorf("session %s: its agent: %w", r.PublicID, err)
	}
	s := Session{ID: r.PublicID, Env: env.Name, Agent: agent.Name, Actor: "wt-" + r.PublicID, Branch: r.Branch, Preview: r.Preview,
		Transcript: r.Transcript, Turns: r.Turns, State: r.State, Title: r.Title, Error: r.Error, Mark: r.Mark,
		Pending: r.Pending, Forked: r.Forked, Outcomes: r.Outcomes, By: by, At: r.StartedAt, Last: r.LastAt,
		Events: []llm.Event{}}
	if !events {
		return s, nil
	}
	var rows []db.Event
	if err := tx.Where("session_id = ?", r.ID).Order("position").Find(&rows).Error; err != nil {
		return s, err
	}
	for _, e := range rows {
		ev := llm.Event{Kind: e.Kind, Tool: e.Tool, Content: e.Content, ToolID: e.ToolID, Parent: e.Parent, At: e.At}
		if len(e.Meta) > 0 && !bytes.Equal(e.Meta, []byte("null")) {
			ev.Meta = e.Meta
		}
		s.Events = append(s.Events, ev)
	}
	return s, nil
}

// Writes the session's row, made on its first write, and appends the events it holds that its rows do not.
func (ws *Workspace) write(s *Session) error {
	return ws.DB.Transaction(func(tx *gorm.DB) error {
		r, err := rowOf(tx, s.ID)
		if errors.As(err, new(NotFound)) {
			if r, err = ws.newSession(tx, s); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		// The title is SetTitle's alone: a turn's copy of the session never writes it back.
		r.Branch, r.Preview, r.Transcript, r.Turns, r.State, r.Error = s.Branch, s.Preview, s.Transcript, s.Turns,
			s.State, s.Error
		r.Mark, r.Pending, r.Forked, r.Outcomes, r.LastAt = s.Mark, s.Pending, s.Forked, s.Outcomes, s.Last
		if err := tx.Save(&r).Error; err != nil {
			return err
		}
		var n int64
		if err := tx.Model(&db.Event{}).Where("session_id = ?", r.ID).Count(&n).Error; err != nil {
			return err
		}
		for i := int(n); i < len(s.Events); i++ {
			e := s.Events[i]
			row := db.Event{SessionID: r.ID, Position: i, Kind: e.Kind, Tool: e.Tool, ToolID: e.ToolID, Parent: e.Parent,
				Content: e.Content, Meta: e.Meta, At: e.At}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (ws *Workspace) newSession(tx *gorm.DB, s *Session) (db.Session, error) {
	env, err := environmentRow(tx, s.Env)
	if err != nil {
		return db.Session{}, err
	}
	// A session that names no agent runs as the workspace's own.
	agent, err := agentRow(tx, cmp.Or(s.Agent, agentName))
	if err != nil {
		return db.Session{}, err
	}
	by, err := member(tx, s.By)
	if err != nil {
		return db.Session{}, err
	}
	r := db.Session{PublicID: s.ID, AgentID: agent.ID, EnvironmentID: env.ID, MemberID: by, StartedAt: s.At, Title: s.Title}
	return r, tx.Create(&r).Error
}

// Every session, without its events, removed ones too when gone is set.
func (ws *Workspace) sessions(gone bool, events bool) ([]Session, error) {
	q := ws.DB
	if gone {
		q = q.Unscoped()
	}
	var rows []db.Session
	if err := q.Order("last_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]Session, 0, len(rows))
	for _, r := range rows {
		s, err := ws.session(ws.DB, r, events)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

// Every session ever started, removed ones included, with its events: what usage counts.
func (ws *Workspace) History() ([]Session, error) { return ws.sessions(true, true) }

// The session's first prompt, which a list shows when it has no title.
func (ws *Workspace) firstPrompt(sid string) (string, error) {
	r, err := rowOf(ws.DB, sid)
	if err != nil {
		return "", err
	}
	var prompts []string
	err = ws.DB.Model(&db.Event{}).Where("session_id = ? AND kind = ?", r.ID, "prompt").Order("position").Limit(1).
		Pluck("content", &prompts).Error
	if len(prompts) == 0 {
		return "", err
	}
	return prompts[0], err
}
