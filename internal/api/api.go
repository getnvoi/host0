// The plane's HTTP API as OpenAPI 3.0.3. controlplane openapi writes the spec; client/ and h0's commands are
// generated from it.
package api

import _ "embed"

//go:generate go run ../../cmd/controlplane openapi openapi.yaml
//go:generate go tool oapi-codegen -config client/oapi.yaml openapi.yaml
//go:generate go run ./h0gen openapi.yaml ../../cmd/h0/remote/commands.gen.go

//go:embed openapi.yaml
var Spec []byte
