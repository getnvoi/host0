module github.com/getnvoi/nvoi/cloudflare

go 1.27.0

require (
	github.com/getnvoi/nvoi/infra v0.0.0
	github.com/getnvoi/nvoi/shared v0.0.0
)

replace (
	github.com/getnvoi/nvoi/infra => ../infra
	github.com/getnvoi/nvoi/shared => ../shared
)
