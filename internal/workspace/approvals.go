package workspace

import (
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/db"
)

// A tool's input or an outcome as its column holds it: JSON as it is, any other text as a JSON string.
func asJSON(s string) json.RawMessage {
	if s == "" {
		return nil
	}
	if json.Valid([]byte(s)) {
		return json.RawMessage(s)
	}
	b, _ := json.Marshal(s)
	return b
}

func fromJSON(raw json.RawMessage) string {
	var s string
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return string(raw)
}

func (ws *Workspace) approvalOf(tx *gorm.DB, r db.Approval) (Approval, error) {
	var s db.Session
	if err := tx.Unscoped().First(&s, r.SessionID).Error; err != nil {
		return Approval{}, fmt.Errorf("approval %s: its session: %w", r.PublicID, err)
	}
	by, err := login(tx, r.DecidedByID)
	if err != nil {
		return Approval{}, fmt.Errorf("approval %s: who decided it: %w", r.PublicID, err)
	}
	a := Approval{ID: r.PublicID, Session: s.PublicID, Turn: r.Turn, Tool: r.Tool, ToolID: r.ToolID, Input: fromJSON(r.Input),
		Call: r.Call, State: r.State, Outcome: fromJSON(r.Outcome), At: r.AskedAt, By: by, Allow: r.Allow}
	if r.DecidedAt != nil {
		a.Decided = *r.DecidedAt
	}
	return a, nil
}

// The approval with the id; NotFound when there is none.
func (ws *Workspace) Approval(aid string) (Approval, error) {
	var r db.Approval
	err := ws.DB.Where("public_id = ?", aid).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Approval{}, NotFound{fmt.Errorf("no approval %s", aid)}
	}
	if err != nil {
		return Approval{}, err
	}
	return ws.approvalOf(ws.DB, r)
}

// The approvals of the session, every session's when it is empty, in the states given, every state when none is.
func (ws *Workspace) Approvals(session string, states ...string) ([]Approval, error) {
	q := ws.DB.Model(&db.Approval{})
	if session != "" {
		q = q.Where("session_id IN (?)", ws.DB.Unscoped().Model(&db.Session{}).Select("id").Where("public_id = ?", session))
	}
	if len(states) > 0 {
		q = q.Where("state IN ?", states)
	}
	var rows []db.Approval
	if err := q.Order("asked_at, public_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := []Approval{}
	for _, r := range rows {
		a, err := ws.approvalOf(ws.DB, r)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

// Writes a over the row of its id, or as a new one.
func (ws *Workspace) putApproval(a Approval) error {
	return ws.DB.Transaction(func(tx *gorm.DB) error {
		var s db.Session
		if err := tx.Unscoped().Where("public_id = ?", a.Session).First(&s).Error; err != nil {
			return fmt.Errorf("approval %s: session %s: %w", a.ID, a.Session, err)
		}
		var r db.Approval
		if err := tx.Where("public_id = ?", a.ID).First(&r).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		by, err := member(tx, a.By)
		if err != nil {
			return err
		}
		shown := ws.Mask(a.Input)
		if a.Call == "" && shown != a.Input {
			a.Call = a.Input
		}
		r.PublicID, r.SessionID, r.Turn, r.Tool, r.ToolID, r.Input = a.ID, s.ID, a.Turn, a.Tool, a.ToolID, asJSON(shown)
		r.Call = a.Call
		r.State, r.Outcome, r.DecidedByID, r.AskedAt, r.Allow = a.State, asJSON(ws.Mask(a.Outcome)), by, a.At, a.Allow
		r.DecidedAt = nil
		if !a.Decided.IsZero() {
			d := a.Decided
			r.DecidedAt = &d
		}
		return tx.Save(&r).Error
	})
}
