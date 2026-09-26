package store

import "testing"

func TestListNested(t *testing.T) {
	f := &Files{Root: t.TempDir()}
	f.Put("usage", "2026-09-25/a", 1)
	f.Put("usage", "2026-09-25/seed:web", 2)
	f.Put("usage", "2026-09-26/a", 3)
	var got []int
	f.List("usage", func(d func(any) error) error {
		var n int
		d(&n)
		got = append(got, n)
		return nil
	})
	if len(got) != 3 || got[0] != 1 || got[2] != 3 {
		t.Fatalf("listed %v", got)
	}
	var n int
	if err := f.Get("usage", "2026-09-25/seed:web", &n); err != nil || n != 2 {
		t.Fatalf("get %d %v", n, err)
	}
}

func TestListSkipsBadRecords(t *testing.T) {
	f := &Files{Root: t.TempDir()}
	f.Put("things", "a", 1)
	f.Put("things", "b", "not a number")
	f.Put("things", "c", 3)
	var got []int
	err := f.List("things", func(d func(any) error) error {
		var n int
		if err := d(&n); err != nil {
			return err
		}
		got = append(got, n)
		return nil
	})
	if err != nil || len(got) != 2 || got[0] != 1 || got[1] != 3 {
		t.Fatalf("listed %v %v", got, err)
	}
}
