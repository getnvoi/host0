package main

import (
	"context"

	"github.com/danielgtaylor/huma/v2"

	"github.com/getnvoi/host0/internal/auth"
)

type LoginLinkInput struct {
	Label string `json:"label" minLength:"1" doc:"Who the browser signs in as"`
}

type LoginLink struct {
	URL string `json:"url" doc:"Signs one browser in, once, within 60 seconds"`
}

type SignedOut struct {
	Count int `json:"count" doc:"How many browsers were signed out"`
}

// Sign-in links and the browsers they signed in: the CLI's alone, never a browser's.
func (p *plane) signIns(a huma.API) {
	huma.Register(a, bearerOnly(op("invite", "POST", "/login-links", "A one-time link that signs a browser in to the web UI",
		h0{By: []string{"open", "invite"}})),
		func(_ context.Context, in *struct{ Body LoginLinkInput }) (*body[LoginLink], error) {
			url, err := p.auth.LoginLink(p.app, in.Body.Label)
			return answer(LoginLink{url}, err)
		})
	huma.Register(a, bearerOnly(op("browsers", "GET", "/browsers", "Browsers signed in to the web UI",
		h0{Output: "table", Columns: []string{"label", "at", "until"}})),
		func(context.Context, *struct{}) (*body[[]auth.Browser], error) {
			return answer(p.auth.Browsers())
		})
	huma.Register(a, bearerOnly(op("logout", "DELETE", "/browsers/{label}", "Sign out the browsers under label",
		h0{By: []string{"logout"}})),
		func(_ context.Context, in *struct {
			Label string `path:"label" doc:"The label their link was asked with"`
		}) (*body[SignedOut], error) {
			n, err := p.auth.SignOut(in.Label)
			return answer(SignedOut{n}, err)
		})
	huma.Register(a, bearerOnly(op("logout.all", "DELETE", "/browsers", "Sign out every browser", h0{By: []string{"logout"}})),
		func(context.Context, *struct{}) (*body[SignedOut], error) {
			n, err := p.auth.SignOut("")
			return answer(SignedOut{n}, err)
		})
}
