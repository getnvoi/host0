module github.com/getnvoi/host0/hetzner

go 1.27.0

require (
	github.com/getnvoi/host0/infra v0.0.0
	github.com/getnvoi/host0/shared v0.0.0
)

replace (
	github.com/getnvoi/host0/infra => ../infra
	github.com/getnvoi/host0/shared => ../shared
)
