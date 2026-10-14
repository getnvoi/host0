package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"slices"
	"sync"

	"github.com/libdns/libdns"

	"github.com/getnvoi/host0/internal/edge/dns"
)

// The challenge values this proxy has presented and not yet removed, on the node's disk: a value written by a run
// that died before its cleanup is removed by the next run, and no other value at that name is ever touched.
type journal struct {
	zone *dns.Zone
	path string
	mu   sync.Mutex
}

type entry struct{ Zone, Name, Text string }

func (j *journal) read() ([]entry, error) {
	raw, err := os.ReadFile(j.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var es []entry
	return es, json.Unmarshal(raw, &es)
}

func (j *journal) write(es []entry) error {
	raw, err := json.Marshal(es)
	if err != nil {
		return err
	}
	tmp := j.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, j.path)
}

// Adds or drops the records' entries.
func (j *journal) note(zone string, recs []libdns.Record, add bool) error {
	es, err := j.read()
	if err != nil {
		return err
	}
	for _, r := range recs {
		e := entry{zone, r.RR().Name, r.RR().Data}
		es = slices.DeleteFunc(es, func(x entry) bool { return x == e })
		if add {
			es = append(es, e)
		}
	}
	return j.write(es)
}

func (j *journal) AppendRecords(ctx context.Context, zone string, recs []libdns.Record) ([]libdns.Record, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if err := j.note(zone, recs, true); err != nil {
		return nil, err
	}
	return j.zone.AppendRecords(ctx, zone, recs)
}

func (j *journal) DeleteRecords(ctx context.Context, zone string, recs []libdns.Record) ([]libdns.Record, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	out, err := j.zone.DeleteRecords(ctx, zone, recs)
	if err != nil {
		return nil, err
	}
	return out, j.note(zone, recs, false)
}

func (j *journal) recover(ctx context.Context) error {
	es, err := j.read()
	if err != nil {
		return err
	}
	for _, e := range es {
		if _, err := j.DeleteRecords(ctx, e.Zone, []libdns.Record{libdns.TXT{Name: e.Name, Text: e.Text}}); err != nil {
			return err
		}
	}
	return nil
}
