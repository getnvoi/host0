// The plane's API as oapi-codegen generates it from internal/api/openapi.yaml, and how its answers are read.
package client

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// A request the plane refused: its status and the sentence it wrote.
type Refused struct {
	Status int
	Detail string
}

func (r *Refused) Error() string { return r.Detail }

// The refusal res carries, its body read and closed.
func refusal(res *http.Response) error {
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("%s %s: %s, and its body: %w", res.Request.Method, res.Request.URL.Path, res.Status, err)
	}
	said := strings.TrimSpace(string(b))
	if said == "" {
		said = res.Status
	}
	return &Refused{Status: res.StatusCode, Detail: said}
}

// The response to a request that succeeded; the caller closes its body.
func OK(res *http.Response, err error) (*http.Response, error) {
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		return nil, refusal(res)
	}
	return res, nil
}

// Whether the request succeeded; the body is closed.
func Done(res *http.Response, err error) error {
	res, err = OK(res, err)
	if err != nil {
		return err
	}
	return res.Body.Close()
}

// The answer as T.
func Read[T any](res *http.Response, err error) (T, error) {
	var out T
	res, err = OK(res, err)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return out, fmt.Errorf("%s %s: %w", res.Request.Method, res.Request.URL.Path, err)
	}
	return out, nil
}

// Whether err is the plane saying the thing asked for does not exist.
func Missing(err error) bool {
	var r *Refused
	return errors.As(err, &r) && r.Status == http.StatusNotFound
}
