package tools

import "context"

type SetTitle struct{}

func (SetTitle) Name() string            { return "set_title" }
func (SetTitle) Description() string     { return "Name this task in a few words." }
func (SetTitle) Args() map[string]string { return map[string]string{"title": "string"} }
func (SetTitle) Policy() string          { return "auto" }
func (SetTitle) Do(_ context.Context, c *Call, in Input) string {
	c.Title = in.Title
	return "set_title: done"
}
