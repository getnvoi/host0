// infra.Shell over one SSH connection to the control node, as root.
package ssh

import (
	"context"
	"fmt"
	"io"
	"net"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"github.com/getnvoi/nvoi/infra"
)

type Client struct {
	conn *gossh.Client
	addr string
}

var _ infra.Shell = (*Client)(nil)

// Waits for sshd while a new server boots; an authentication failure is final.
func Dial(ctx context.Context, addr string, key []byte) (*Client, error) {
	signer, err := gossh.ParsePrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("ssh key: %w", err)
	}
	cfg := &gossh.ClientConfig{
		User:            "root",
		Auth:            []gossh.AuthMethod{gossh.PublicKeys(signer)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}
	for deadline := time.Now().Add(5 * time.Minute); ; {
		conn, err := gossh.Dial("tcp", addr, cfg)
		if err == nil {
			return &Client{conn: conn, addr: addr}, nil
		}
		if _, auth := err.(*gossh.ServerAuthError); auth || time.Now().After(deadline) {
			return nil, fmt.Errorf("ssh %s: %w", addr, err)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
}

func (c *Client) Run(ctx context.Context, cmd string, stdin io.Reader, out io.Writer) error {
	s, err := c.conn.NewSession()
	if err != nil {
		return err
	}
	defer s.Close()
	s.Stdin, s.Stdout, s.Stderr = stdin, out, out
	done := make(chan error, 1)
	go func() { done <- s.Run(cmd) }()
	select {
	case <-ctx.Done():
		_ = s.Signal(gossh.SIGKILL)
		return ctx.Err()
	case err := <-done:
		if err != nil {
			return fmt.Errorf("ssh %s: %s: %w", c.addr, headline(cmd), err)
		}
		return nil
	}
}

func (c *Client) Forward(ctx context.Context, local, remote string) (func(), error) {
	l, err := net.Listen("tcp", local)
	if err != nil {
		return nil, fmt.Errorf("forward %s: %w", local, err)
	}
	go func() {
		for {
			in, err := l.Accept()
			if err != nil {
				return
			}
			go func() {
				defer in.Close()
				up, err := c.conn.Dial("tcp", remote)
				if err != nil {
					return
				}
				defer up.Close()
				go io.Copy(up, in)
				io.Copy(in, up)
			}()
		}
	}()
	return func() { l.Close() }, nil
}

func (c *Client) Close() error { return c.conn.Close() }

func headline(cmd string) string {
	for i, r := range cmd {
		if r == '\n' || i == 80 {
			return cmd[:i]
		}
	}
	return cmd
}
