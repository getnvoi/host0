// The web UI's build, embedded. packages/ui builds into dist/; without a build the plane says so instead.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
