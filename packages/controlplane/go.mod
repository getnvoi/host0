module github.com/getnvoi/host0/controlplane

go 1.27.0

require (
	github.com/agent-substrate/substrate v0.0.0-20260924022005-31a5e0ba29a5
	github.com/getnvoi/host0/shared v0.0.0
	google.golang.org/grpc v1.83.2
	google.golang.org/protobuf v1.36.12
)

require (
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260803160001-6ac0973c030d // indirect
)

replace github.com/getnvoi/host0/shared => ../shared
