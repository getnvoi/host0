module github.com/getnvoi/host0/cli

go 1.27.0

require (
	github.com/getnvoi/host0/cloudflare v0.0.0
	github.com/getnvoi/host0/hetzner v0.0.0
	github.com/getnvoi/host0/infra v0.0.0
	github.com/getnvoi/host0/shared v0.0.0
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
	github.com/getnvoi/host0/cloudflare => ../cloudflare
	github.com/getnvoi/host0/hetzner => ../hetzner
	github.com/getnvoi/host0/infra => ../infra
	github.com/getnvoi/host0/shared => ../shared
)
