package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// Every refusal is a text/plain sentence the app shows as it is; Huma's own, validation included, are one sentence, 400.
func init() { huma.NewError = refuse }

type sentence struct {
	status int
	text   string
}

func (s *sentence) Error() string               { return s.text }
func (s *sentence) GetStatus() int              { return s.status }
func (s *sentence) ContentType(string) string   { return "text/plain; charset=utf-8" }
func said(status int, f string, a ...any) error { return &sentence{status, fmt.Sprintf(f, a...)} }

func refuse(status int, msg string, errs ...error) huma.StatusError {
	if len(errs) > 0 {
		each := make([]string, len(errs))
		for i, err := range errs {
			var d *huma.ErrorDetail
			if errors.As(err, &d) && d.Location != "" {
				each[i] = d.Location + ": " + d.Message
			} else {
				each[i] = err.Error()
			}
		}
		msg = strings.Join(each, "; ")
		if status == http.StatusUnprocessableEntity {
			status = http.StatusBadRequest
		}
	}
	return &sentence{status, msg}
}

// The format a sentence is written in.
var plain = huma.Format{
	Marshal: func(w io.Writer, v any) error {
		s, ok := v.(*sentence)
		if !ok {
			return fmt.Errorf("text/plain answers a sentence, not %T", v)
		}
		_, err := io.WriteString(w, s.text)
		return err
	},
	Unmarshal: func([]byte, any) error { return errors.New("the hub reads no text/plain body") },
}

// err as the handler's answer: a sentence keeps its status, anything else is the hub failing, 500, said as it is.
func fail(err error) error {
	var s *sentence
	if err == nil || errors.As(err, &s) {
		return err
	}
	return &sentence{http.StatusInternalServerError, err.Error()}
}

// Writes a sentence, for the routes outside Huma.
func write(w http.ResponseWriter, err error) {
	var s *sentence
	if !errors.As(err, &s) {
		s = &sentence{http.StatusInternalServerError, err.Error()}
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(s.status)
	io.WriteString(w, s.text)
}
