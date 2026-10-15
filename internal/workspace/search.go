package workspace

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
)

// The most hits one search answers, and how many it answers when it is not told.
const (
	SearchMax   = 100
	SearchLimit = 20
)

// One record a search matched, and the words around the match on one line, each matched word in **.
type Hit struct {
	Session string `json:"session"`
	Env     string `json:"env"`
	In      string `json:"in"`             // title, event, queued or note
	Kind    string `json:"kind,omitempty"` // the event's kind
	// The record's place among the session's events, queue or notes; 0 for its title.
	Position int       `json:"position"`
	Snippet  string    `json:"snippet"`
	Removed  bool      `json:"removed,omitempty"` // the session was removed; its records are still found
	At       time.Time `json:"at"`                // when the session was last active
}

// Each FTS5 index migrate0001 keeps, as a select of its hits ranked by bm25; ? is the MATCH.
var searched = []string{
	`SELECT 'title' AS "in", '' AS kind, 0 AS position, s.id AS sid, snippet(sessions_fts, 0, '**', '**', '…', 16) AS snippet,
		bm25(sessions_fts) AS rank FROM sessions_fts JOIN sessions s ON s.id = sessions_fts.rowid WHERE sessions_fts MATCH ?`,
	`SELECT 'event', e.kind, e.position, e.session_id, snippet(events_fts, 0, '**', '**', '…', 16),
		bm25(events_fts) FROM events_fts JOIN events e ON e.id = events_fts.rowid WHERE events_fts MATCH ?`,
	`SELECT 'queued', '', q.position, q.session_id, snippet(queued_messages_fts, 0, '**', '**', '…', 16),
		bm25(queued_messages_fts) FROM queued_messages_fts JOIN queued_messages q ON q.id = queued_messages_fts.rowid
		WHERE queued_messages_fts MATCH ?`,
	`SELECT 'note', '', n.position, n.session_id, snippet(notes_fts, 0, '**', '**', '…', 16),
		bm25(notes_fts) FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid WHERE notes_fts MATCH ?`,
}

// Titles, events, queued messages and notes matching every word of query, the best first, limit at most. A removed
// session keeps its records, so they are found, marked removed.
func (ws *Workspace) Search(query string, limit int) ([]Hit, error) {
	if limit < 1 || limit > SearchMax {
		return nil, Invalid{fmt.Errorf("limit %d: from 1 to %d", limit, SearchMax)}
	}
	match, err := ftsQuery(query)
	if err != nil {
		return nil, Invalid{err}
	}
	var rows []struct {
		In       string `gorm:"column:in"`
		Kind     string
		Position int
		Snippet  string
		Rank     float64
		Session  string
		Env      string
		Removed  bool
		At       time.Time
	}
	q := `SELECT h."in", h.kind, h.position, h.snippet, h.rank, s.public_id AS session, e.name AS env,
		s.deleted_at IS NOT NULL AS removed, s.last_at AS at
		FROM (` + strings.Join(searched, " UNION ALL ") + `) h
		JOIN sessions s ON s.id = h.sid JOIN environments e ON e.id = s.environment_id
		ORDER BY h.rank, s.last_at DESC, h.position LIMIT ?`
	args := []any{match, match, match, match, limit}
	if err := ws.DB.Raw(q, args...).Scan(&rows).Error; err != nil {
		if strings.Contains(err.Error(), "fts5:") {
			return nil, Invalid{fmt.Errorf("search %q: %w", query, err)}
		}
		return nil, fmt.Errorf("search %q: %w", query, err)
	}
	hits := make([]Hit, 0, len(rows))
	for _, r := range rows {
		hits = append(hits, Hit{Session: r.Session, Env: r.Env, In: r.In, Kind: r.Kind, Position: r.Position,
			Snippet: strings.Join(strings.Fields(r.Snippet), " "), Removed: r.Removed, At: r.At})
	}
	return hits, nil
}

// query as an FTS5 MATCH of plain words: each word, or each "quoted phrase", a string that must all match. Every
// character FTS5 reads as syntax is inside a string, so no query is malformed.
func ftsQuery(query string) (string, error) {
	var terms []string
	for i, part := range strings.Split(query, `"`) {
		words := strings.Fields(part)
		if i%2 == 1 && len(words) > 0 {
			words = []string{strings.Join(words, " ")}
		}
		for _, w := range words {
			if strings.IndexFunc(w, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0 {
				terms = append(terms, `"`+w+`"`)
			}
		}
	}
	if len(terms) == 0 {
		return "", errors.New("a search needs a word: letters or digits")
	}
	return strings.Join(terms, " "), nil
}
