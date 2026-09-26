// controlplane.Sandboxes on Agent Substrate: one gVisor actor per sandbox, reached through the atenet router.
package substrate

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	pb "github.com/agent-substrate/substrate/pkg/proto/ateapipb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/getnvoi/nvoi/controlplane"
	"github.com/getnvoi/nvoi/shared/tiers"
)

type Config struct {
	API, Authority, CAFile, TokenFile string
	Router                            string // host:port of the router's CONNECT listener
	Atespace, Snapshots               string
}

type Client struct {
	cfg Config
	api pb.ControlClient
}

var _ controlplane.Sandboxes = (*Client)(nil)

func New(cfg Config) (*Client, error) {
	ca, err := os.ReadFile(cfg.CAFile)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(ca)
	conn, err := grpc.NewClient(cfg.API,
		grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{RootCAs: pool, ServerName: cfg.Authority})),
		grpc.WithAuthority(cfg.Authority),
		grpc.WithUnaryInterceptor(func(ctx context.Context, m string, req, reply any, cc *grpc.ClientConn, inv grpc.UnaryInvoker, o ...grpc.CallOption) error {
			tok, err := os.ReadFile(cfg.TokenFile)
			if err != nil {
				return err
			}
			ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+strings.TrimSpace(string(tok)))
			return inv(ctx, m, req, reply, cc, o...)
		}))
	if err != nil {
		return nil, err
	}
	c := &Client{cfg: cfg, api: pb.NewControlClient(conn)}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err = c.api.CreateAtespace(ctx, &pb.CreateAtespaceRequest{Atespace: &pb.Atespace{Metadata: &pb.ResourceMetadata{Name: cfg.Atespace}}})
	if exists(err) {
		err = nil
	}
	return c, err
}

func exists(err error) bool { return status.Code(err) == codes.AlreadyExists }

func (c *Client) ref(name string) *pb.ObjectRef {
	return &pb.ObjectRef{Atespace: c.cfg.Atespace, Name: name}
}

func decode(v map[string]any, m proto.Message) error {
	b, _ := json.Marshal(v)
	return protojson.Unmarshal(b, m)
}

func (c *Client) Template(ctx context.Context, env string, tier tiers.Tier, cs []controlplane.Container) (string, error) {
	var containers []map[string]any
	for _, ct := range cs {
		keys := make([]string, 0, len(ct.Env))
		for k := range ct.Env {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var envs []map[string]string
		for _, k := range keys {
			envs = append(envs, map[string]string{"name": k, "value": ct.Env[k]})
		}
		m := map[string]any{
			"name": ct.Name, "image": ct.Image, "command": ct.Command, "env": envs,
			"volumeMounts": []map[string]string{{"name": "work", "mountPath": "/workspace"}},
			// Services that drop to their own user (postgres) need these; gVisor's default set is narrower.
			"securityContext": map[string]any{"capabilities": map[string]any{
				"add": []string{"CHOWN", "FOWNER", "DAC_OVERRIDE", "SETUID", "SETGID"}}},
		}
		if ct.Probe != 0 {
			m["wakeupProbe"] = map[string]any{"httpGet": map[string]any{"path": "/health", "port": ct.Probe}}
		}
		containers = append(containers, m)
	}
	spec := map[string]any{
		"workerSelector": map[string]any{"matchLabels": map[string]string{"workload": tier.Pool()}},
		"containers":     containers,
		"resources": map[string]any{"limits": []map[string]string{
			{"name": "cpu", "quantity": tier.CPU}, {"name": "memory", "quantity": tier.Memory}}},
		"snapshotConfig": map[string]any{"onPause": "SNAPSHOT_CONTENT_SCOPE_FULL", "onCommit": "SNAPSHOT_CONTENT_SCOPE_FULL",
			"storageLocation": c.cfg.Snapshots},
		"sandboxConfig": map[string]any{"sandboxClass": "SANDBOX_CLASS_GVISOR", "configName": "gvisor-default"},
		"volumes":       []map[string]any{{"name": "work", "durableDir": map[string]any{}}},
	}
	b, _ := json.Marshal(spec)
	sum := sha256.Sum256(b)
	name := fmt.Sprintf("%s-%s", env, hex.EncodeToString(sum[:])[:10])
	spec["metadata"] = map[string]string{"atespace": c.cfg.Atespace, "name": name}
	t := &pb.ActorTemplate{}
	if err := decode(spec, t); err != nil {
		return "", fmt.Errorf("template: %w", err)
	}
	if _, err := c.api.CreateActorTemplate(ctx, &pb.CreateActorTemplateRequest{ActorTemplate: t}); err != nil && !exists(err) {
		return "", fmt.Errorf("create template %s: %w", name, err)
	}
	return name, nil
}

func (c *Client) Create(ctx context.Context, name, template, tag string) error {
	a := &pb.Actor{Metadata: &pb.ResourceMetadata{Atespace: c.cfg.Atespace, Name: name}, ActorTemplate: c.ref(template)}
	if tag != "" {
		a.SourceTag = c.ref(tag)
	}
	if _, err := c.api.CreateActor(ctx, &pb.CreateActorRequest{Actor: a}); err != nil && !exists(err) {
		return fmt.Errorf("create actor %s: %w", name, err)
	}
	// Actors reach nothing outside without a policy. Every destination for now; per-environment hosts come later.
	policy := &pb.EgressPolicy{}
	if err := decode(map[string]any{"metadata": map[string]string{"atespace": c.cfg.Atespace, "name": "default"},
		"rules": []map[string]any{{"all": map[string]any{}}}}, policy); err != nil {
		return err
	}
	if _, err := c.api.CreateActorEgressPolicy(ctx, &pb.CreateActorEgressPolicyRequest{Actor: c.ref(name), EgressPolicy: policy}); err != nil && !exists(err) {
		return fmt.Errorf("egress policy %s: %w", name, err)
	}
	return nil
}

func (c *Client) Resume(ctx context.Context, name string) error {
	for deadline := time.Now().Add(10 * time.Minute); ; {
		_, err := c.api.ResumeActor(ctx, &pb.ResumeActorRequest{Actor: c.ref(name)})
		switch status.Code(err) {
		case codes.OK:
			return c.await(ctx, name, pb.ActorState_ACTOR_STATE_RUNNING)
		case codes.ResourceExhausted:
			return controlplane.ErrNoWorker
		case codes.Aborted:
			// Another operation on it, such as its template's golden actor being made.
			if time.Now().After(deadline) {
				return fmt.Errorf("resume actor %s: busy for 10m: %w", name, err)
			}
			if err := pause(ctx, 3*time.Second); err != nil {
				return err
			}
			continue
		}
		return fmt.Errorf("resume actor %s: %w", name, err)
	}
}

// Waits d, or less when ctx ends first.
func pause(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

func (c *Client) State(ctx context.Context, name string) (string, error) {
	a, err := c.api.GetActor(ctx, &pb.GetActorRequest{Actor: c.ref(name)})
	if status.Code(err) == codes.NotFound {
		return "", controlplane.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return strings.ToLower(strings.TrimPrefix(a.GetStatus().GetState().String(), "ACTOR_STATE_")), nil
}

func (c *Client) Node(ctx context.Context, name string) (string, error) {
	a, err := c.api.GetActor(ctx, &pb.GetActorRequest{Actor: c.ref(name)})
	if err != nil {
		return "", err
	}
	w, err := c.api.GetWorker(ctx, &pb.GetWorkerRequest{Worker: a.GetStatus().GetWorkerAssignment().GetWorker()})
	if err != nil {
		return "", fmt.Errorf("worker of %s: %w", name, err)
	}
	return w.GetNodeName(), nil
}

func (c *Client) Pause(ctx context.Context, name string) error {
	if _, err := c.api.PauseActor(ctx, &pb.PauseActorRequest{Actor: c.ref(name)}); err != nil {
		return fmt.Errorf("pause %s: %w", name, err)
	}
	return c.await(ctx, name, pb.ActorState_ACTOR_STATE_PAUSED)
}

func (c *Client) Workers(ctx context.Context) ([]controlplane.Worker, error) {
	res, err := c.api.ListWorkers(ctx, &pb.ListWorkersRequest{PageSize: 1000})
	if err != nil {
		return nil, err
	}
	var out []controlplane.Worker
	for _, w := range res.GetWorkers() {
		as, err := c.api.ListWorkerActorAssignments(ctx, &pb.ListWorkerActorAssignmentsRequest{
			Worker: &pb.ObjectRef{Name: w.GetMetadata().GetName()}, PageSize: 10})
		if err != nil {
			return nil, err
		}
		out = append(out, controlplane.Worker{Pool: w.GetWorkerPool(), Pod: w.GetWorkerPod(), Assigned: len(as.GetActorAssignments()) > 0})
	}
	return out, nil
}

func (c *Client) Suspend(ctx context.Context, name string) error {
	if _, err := c.api.SuspendActor(ctx, &pb.SuspendActorRequest{Actor: c.ref(name)}); err != nil {
		return fmt.Errorf("suspend %s: %w", name, err)
	}
	return c.await(ctx, name, pb.ActorState_ACTOR_STATE_SUSPENDED)
}

func (c *Client) Tag(ctx context.Context, tag, actor string) error {
	_, err := c.api.CreateTag(ctx, &pb.CreateTagRequest{Tag: &pb.Tag{
		Metadata: &pb.ResourceMetadata{Atespace: c.cfg.Atespace, Name: tag}, SourceActor: c.ref(actor), Scope: pb.TagScope_TAG_SCOPE_ATESPACE}})
	if err != nil && !exists(err) {
		return fmt.Errorf("tag %s: %w", tag, err)
	}
	return nil
}

func (c *Client) Delete(ctx context.Context, name string) error {
	_, err := c.api.DeleteActor(ctx, &pb.DeleteActorRequest{Actor: c.ref(name), AnyState: true})
	if status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}

func (c *Client) await(ctx context.Context, name string, want pb.ActorState) error {
	for deadline := time.Now().Add(10 * time.Minute); time.Now().Before(deadline); {
		a, err := c.api.GetActor(ctx, &pb.GetActorRequest{Actor: c.ref(name)})
		if err != nil {
			return err
		}
		switch s := a.GetStatus().GetState(); s {
		case want:
			return nil
		case pb.ActorState_ACTOR_STATE_CRASHED:
			return fmt.Errorf("actor %s crashed", name)
		}
		if err := pause(ctx, time.Second); err != nil {
			return err
		}
	}
	return fmt.Errorf("actor %s not %s after 10m", name, want)
}

// An HTTP CONNECT to the router naming the actor; the router resumes it and holds the request until it answers.
func (c *Client) Dial(ctx context.Context, actor string, port int) (net.Conn, error) {
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", c.cfg.Router)
	if err != nil {
		return nil, err
	}
	// The handshake is bounded by ctx's deadline, 30 seconds without one; the connection after it is not.
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(30 * time.Second)
	}
	conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { conn.SetDeadline(time.Now()) })
	defer stop()
	target := fmt.Sprintf("%s:%d", actor, port)
	fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\nate-target-actor: %s/%s\r\n\r\n", target, target, c.cfg.Atespace, actor)
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, &http.Request{Method: "CONNECT"})
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("connect %s: %w", target, err)
	}
	if res.StatusCode != 200 {
		conn.Close()
		return nil, fmt.Errorf("connect %s: %s", target, res.Status)
	}
	if !stop() {
		conn.Close()
		return nil, fmt.Errorf("connect %s: %w", target, ctx.Err())
	}
	conn.SetDeadline(time.Time{})
	if br.Buffered() > 0 {
		return &buffered{conn, br}, nil
	}
	return conn, nil
}

type buffered struct {
	net.Conn
	r *bufio.Reader
}

func (b *buffered) Read(p []byte) (int, error) { return b.r.Read(p) }
