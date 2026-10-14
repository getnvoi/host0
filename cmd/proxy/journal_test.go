package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/libdns/libdns"

	"github.com/getnvoi/host0/internal/edge/dns"
)

func TestJournalRecover(t *testing.T) {
	dir := t.TempDir()
	zonefile := "@ 3600 IN SOA ns1.example.net. hostmaster.nvoi.to. 1 3600 600 604800 1440\n" +
		"_acme-challenge 3600 IN TXT \"another-tools-token\"\n"
	if err := os.WriteFile(filepath.Join(dir, "nvoi.to.zone"), []byte(zonefile), 0o644); err != nil {
		t.Fatal(err)
	}
	z, err := dns.Open("BIND", map[string]string{"directory": dir}, "nvoi.to")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	j := &journal{zone: z, path: filepath.Join(dir, "challenges.json")}
	// A run that presented its value and died before the cleanup.
	if _, err := j.AppendRecords(ctx, "nvoi.to.", []libdns.Record{libdns.TXT{Name: "_acme-challenge", Text: "our-token"}}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(read(t, dir), "our-token") {
		t.Fatal("the value was not written")
	}
	next := &journal{zone: z, path: j.path}
	if err := next.recover(ctx); err != nil {
		t.Fatal(err)
	}
	got := read(t, dir)
	if strings.Contains(got, "our-token") || !strings.Contains(got, "another-tools-token") {
		t.Fatalf("zone after recover:\n%s", got)
	}
	if es, err := next.read(); err != nil || len(es) != 0 {
		t.Fatalf("journal after recover: %v %v", es, err)
	}
}

func read(t *testing.T, dir string) string {
	raw, err := os.ReadFile(filepath.Join(dir, "nvoi.to.zone"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
