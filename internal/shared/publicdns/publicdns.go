// What public resolvers answer for a name, apart from this machine's resolver and the cache in front of it.
package publicdns

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// Cloudflare's and Google's resolvers.
var Resolvers = []string{"1.1.1.1:53", "8.8.8.8:53"}

// The addresses each resolver gives for host, or why it gives none.
func Lookup(ctx context.Context, host string) map[string]string {
	out := map[string]string{}
	for _, addr := range Resolvers {
		r := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, addr)
		}}
		c, cancel := context.WithTimeout(ctx, 5*time.Second)
		ips, err := r.LookupHost(c, host)
		cancel()
		if err != nil {
			out[addr] = err.Error()
			continue
		}
		out[addr] = strings.Join(ips, " ")
	}
	return out
}

// Lookup's answers on one line.
func Say(answers map[string]string) string {
	var says []string
	for _, addr := range Resolvers {
		says = append(says, addr+": "+answers[addr])
	}
	return strings.Join(says, "; ")
}

// Waits until every resolver answers host. A name asked of this machine before its record is served is cached as
// absent by resolvers in between, for as long as the zone says; so nothing local asks for it before this returns.
func Published(ctx context.Context, host string, within time.Duration) error {
	deadline := time.Now().Add(within)
	for {
		answers := Lookup(ctx, host)
		ok := true
		for _, addr := range Resolvers {
			if net.ParseIP(strings.Fields(answers[addr] + " x")[0]) == nil {
				ok = false
			}
		}
		if ok {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s is not published in %s: %s", host, within, Say(answers))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// Dials addr; when this machine's resolver says its host does not exist, dials an address the public resolvers give.
// A cache in between keeps a name absent for as long as the zone says, after its record exists.
func Dial(ctx context.Context, network, addr string) (net.Conn, error) {
	d := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	conn, err := d.DialContext(ctx, network, addr)
	var dnsErr *net.DNSError
	if err == nil || !errors.As(err, &dnsErr) || !dnsErr.IsNotFound {
		return conn, err
	}
	host, port, splitErr := net.SplitHostPort(addr)
	if splitErr != nil {
		return nil, err
	}
	for _, answer := range Lookup(ctx, host) {
		for _, ip := range strings.Fields(answer) {
			if net.ParseIP(ip) == nil {
				break
			}
			if c, dialErr := d.DialContext(ctx, network, net.JoinHostPort(ip, port)); dialErr == nil {
				return c, nil
			}
		}
	}
	return nil, err
}
