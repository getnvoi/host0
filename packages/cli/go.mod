module github.com/getnvoi/nvoi/cli

go 1.27.0

require (
	github.com/getnvoi/nvoi/cloudflare v0.0.0
	github.com/getnvoi/nvoi/hetzner v0.0.0
	github.com/getnvoi/nvoi/infra v0.0.0
	github.com/getnvoi/nvoi/shared v0.0.0
	github.com/spf13/cobra v1.10.2
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.9 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace (
	github.com/getnvoi/nvoi/cloudflare => ../cloudflare
	github.com/getnvoi/nvoi/hetzner => ../hetzner
	github.com/getnvoi/nvoi/infra => ../infra
	github.com/getnvoi/nvoi/shared => ../shared
)
