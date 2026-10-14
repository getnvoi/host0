// The public edge in the cluster: TLS for *.<zone> on 443 from ACME DNS-01, every request passed to the plane with its
// Host; 80 redirects. Everything it is told comes from its environment, which the install writes.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/caddyserver/certmagic"

	"github.com/getnvoi/host0/dns"
)

func must(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("%s is required", name)
	}
	return v
}

func main() {
	var creds map[string]string
	if err := json.Unmarshal([]byte(must("HZ_DNS_CREDS")), &creds); err != nil {
		log.Fatalf("HZ_DNS_CREDS: %v", err)
	}
	zone, err := dns.Open(must("HZ_DNS_PROVIDER"), creds, must("HZ_ZONE"))
	if err != nil {
		log.Fatal(err)
	}
	upstream, err := url.Parse(must("HZ_UPSTREAM"))
	if err != nil {
		log.Fatalf("HZ_UPSTREAM: %v", err)
	}
	dir := must("HZ_STORAGE")
	j := &journal{zone: zone, path: filepath.Join(dir, "challenges.json")}
	if err := j.recover(context.Background()); err != nil {
		log.Fatalf("challenges a previous run left: %v", err)
	}

	certmagic.Default.Storage = &certmagic.FileStorage{Path: dir}
	cfg := certmagic.NewDefault()
	cfg.Issuers = []certmagic.Issuer{certmagic.NewACMEIssuer(cfg, certmagic.ACMEIssuer{
		CA: certmagic.LetsEncryptProductionCA, Agreed: true,
		DisableHTTPChallenge: true, DisableTLSALPNChallenge: true,
		DNS01Solver: &certmagic.DNS01Solver{DNSManager: certmagic.DNSManager{DNSProvider: j}},
	})}
	wildcard := "*." + zone.Name
	// Obtained and renewed in the background: until the first certificate lands, handshakes fail and 80 still redirects.
	if err := cfg.ManageAsync(context.Background(), []string{wildcard}); err != nil {
		log.Fatalf("%s: %v", wildcard, err)
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(upstream)
			r.Out.Host = r.In.Host // the plane routes by Host
			r.SetXForwarded()
		},
		FlushInterval: -1,
	}
	tlsConfig := cfg.TLSConfig()
	tlsConfig.NextProtos = []string{"h2", "http/1.1"}
	tlsConfig.MinVersion = tls.VersionTLS12
	https := &http.Server{Addr: ":443", Handler: proxy, TLSConfig: tlsConfig,
		ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	redirect := &http.Server{Addr: ":80", ReadHeaderTimeout: 10 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://"+r.Host+r.URL.RequestURI(), http.StatusPermanentRedirect)
		})}
	go func() { log.Fatal(redirect.ListenAndServe()) }()
	log.Printf("proxy for %s on :443 to %s", wildcard, upstream)
	log.Fatal(https.ListenAndServeTLS("", ""))
}
