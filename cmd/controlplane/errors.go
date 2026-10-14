package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/auth"
	"github.com/getnvoi/host0/internal/sandbox"
	"github.com/getnvoi/host0/internal/store"
	"github.com/getnvoi/host0/internal/workers"
	"github.com/getnvoi/host0/internal/workspace"
)

// Every refusal is a problem whose detail is the sentence the failing thing wrote; Huma's own, validation
// included, are folded into one sentence and answered 400.
func init() { huma.NewError = refusal }

func refusal(status int, msg string, errs ...error) huma.StatusError {
	if len(errs) > 0 {
		said := make([]string, len(errs))
		for i, err := range errs {
			var d *huma.ErrorDetail
			if errors.As(err, &d) && d.Location != "" {
				said[i] = d.Location + ": " + d.Message
			} else {
				said[i] = err.Error()
			}
		}
		msg = strings.Join(said, "; ")
		if status == http.StatusUnprocessableEntity {
			status = http.StatusBadRequest
		}
	}
	return &huma.ErrorModel{Status: status, Title: http.StatusText(status), Detail: msg}
}

// The status err is answered with: not found 404, a bad request 400, a conflict 409, anything else 422.
func status(err error) int {
	var (
		bad      badRequest
		invalid  workspace.Invalid
		shape    workers.Invalid
		conflict workspace.Conflict
		missing  workspace.NotFound
		nobody   auth.NotFound
	)
	switch {
	case errors.Is(err, store.ErrNotFound), errors.Is(err, sandbox.ErrNotFound), errors.As(err, &missing), errors.As(err, &nobody):
		return http.StatusNotFound
	case errors.As(err, &bad), errors.As(err, &invalid), errors.As(err, &shape):
		return http.StatusBadRequest
	case errors.As(err, &conflict):
		return http.StatusConflict
	}
	return http.StatusUnprocessableEntity
}

// err as the problem a handler returns.
func problem(err error) error {
	if err == nil {
		return nil
	}
	return refusal(status(err), err.Error())
}

// Writes p, for the routes outside Huma.
func writeProblem(w http.ResponseWriter, p huma.StatusError) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.GetStatus())
	json.NewEncoder(w).Encode(p)
}
