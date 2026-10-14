package tools

import (
	"context"
	"strings"
)

type NavigatePreview struct{}

func (NavigatePreview) Name() string { return "navigate_preview" }
func (NavigatePreview) Description() string {
	return "Show the user a page of the app in their preview, by its path (/health)."
}
func (NavigatePreview) Args() map[string]string { return map[string]string{"path": "string"} }
func (NavigatePreview) Policy() string          { return "auto" }

// The UI moves the preview on seeing the call; the tool only checks the path.
func (NavigatePreview) Do(_ context.Context, _ *Call, in Input) string {
	if !strings.HasPrefix(in.Path, "/") {
		return "navigate_preview: a path starting with / is needed"
	}
	return "navigate_preview: the preview shows " + in.Path
}
