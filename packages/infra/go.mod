module github.com/getnvoi/nvoi/infra

go 1.27.0

require (
	github.com/getnvoi/nvoi/shared v0.0.0
	golang.org/x/crypto v0.54.0
)

require golang.org/x/sys v0.47.0 // indirect

replace github.com/getnvoi/nvoi/shared => ../shared
