package dns

import (
	"context"
	"fmt"
	"time"

	"github.com/DNSControl/dnscontrol/v5/models"
	"github.com/libdns/libdns"
)

var (
	_ libdns.RecordAppender = (*Zone)(nil)
	_ libdns.RecordDeleter  = (*Zone)(nil)
)

// libdns names records relative to the zone it is handed, which may be a parent or a child of this one.
func (z *Zone) edits(zone string, recs []libdns.Record, del bool) ([]edit, []libdns.Record, error) {
	var edits []edit
	var out []libdns.Record
	for _, rec := range recs {
		rr := rec.RR()
		if rr.Type != "TXT" {
			return nil, nil, fmt.Errorf("libdns %s %s: only TXT records are written here", rr.Type, rr.Name)
		}
		label, err := z.label(libdns.AbsoluteName(rr.Name, zone))
		if err != nil {
			return nil, nil, err
		}
		e := edit{label: label, typ: "TXT"}
		if del {
			e.del = []string{rr.Data}
		} else {
			e.add = []string{rr.Data}
		}
		edits = append(edits, e)
		out = append(out, libdns.TXT{Name: rr.Name, TTL: TTL * time.Second, Text: rr.Data})
	}
	return edits, out, nil
}

// Adds each TXT value beside the values already at its name.
func (z *Zone) AppendRecords(_ context.Context, zone string, recs []libdns.Record) ([]libdns.Record, error) {
	edits, out, err := z.edits(zone, recs, false)
	if err != nil {
		return nil, err
	}
	_, err = z.apply(func(models.Records) ([]edit, error) { return edits, nil })
	return out, err
}

// Removes exactly these TXT values; another value at the same name stays.
func (z *Zone) DeleteRecords(_ context.Context, zone string, recs []libdns.Record) ([]libdns.Record, error) {
	edits, out, err := z.edits(zone, recs, true)
	if err != nil {
		return nil, err
	}
	_, err = z.apply(func(models.Records) ([]edit, error) { return edits, nil })
	return out, err
}
