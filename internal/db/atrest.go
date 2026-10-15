package db

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/shared/seal"
)

// The database as it lies on disk, measured now: it is at rest without plaintext when OK is true.
type AtRest struct {
	Dir string `json:"dir" doc:"The directory the database lives in"`
	OK  bool   `json:"ok" doc:"No plain header, no marker found, no foreign file and every sealed value sealed"`
	// Known plaintext read through the open database; each is certain to be in the decrypted pages.
	Markers  int      `json:"markers" doc:"Plaintext values read through the database and searched for in its files"`
	Found    int      `json:"found" doc:"Markers found in the files, summed over files; 0 when encrypted"`
	Plain    []string `json:"plain" doc:"Files that start with a plain SQLite or WAL header"`
	Foreign  []string `json:"foreign" doc:"Files in the directory that are not the database, its -wal or its -shm"`
	Sealed   int      `json:"sealed" doc:"Values of sealed columns, as stored"`
	Unsealed []string `json:"unsealed" doc:"Sealed columns holding a value without the sealed prefix, as table.column"`
	Files    []File   `json:"files" doc:"Each file in the directory"`
}

type File struct {
	Name    string `json:"name"`
	Size    int64  `json:"size" doc:"Bytes"`
	Plain   bool   `json:"plain" doc:"It starts with a plain SQLite or WAL header"`
	Found   int    `json:"found" doc:"Markers found in it"`
	Foreign bool   `json:"foreign" doc:"It is not the database, its -wal or its -shm"`
}

// The columns that carry serializer:sealed in models.go; a test holds the two equal.
var sealedColumns = [][2]string{{"llm_configs", "values"}, {"credentials", "value"}, {"secrets", "value"}, {"approvals", "call"}}

// The SQL text of every table is in the schema page, so this one marker exists once a table does.
const schemaMarker = "CREATE TABLE"

// Shorter values are skipped: a few random bytes match ciphertext by chance.
const minMarker = 8

// Inspect measures db, open on the file at path: each file beside it, read raw and searched for plaintext.
func Inspect(db *gorm.DB, path string) (AtRest, error) {
	dir, base := filepath.Dir(path), filepath.Base(path)
	out := AtRest{Dir: dir, Plain: []string{}, Foreign: []string{}, Unsealed: []string{}, Files: []File{}}
	markers := [][]byte{[]byte(schemaMarker)}
	add := func(v string) {
		if len(v) >= minMarker && !slices.ContainsFunc(markers, func(m []byte) bool { return string(m) == v }) {
			markers = append(markers, []byte(v))
		}
	}
	for _, c := range sealedColumns {
		var vs []*string
		if err := db.Raw(fmt.Sprintf("SELECT %q FROM %q", c[1], c[0])).Scan(&vs).Error; err != nil {
			return out, fmt.Errorf("%s.%s: %w", c[0], c[1], err)
		}
		unsealed := false
		for _, v := range vs {
			if v == nil {
				continue
			}
			out.Sealed++
			if !strings.HasPrefix(*v, seal.Prefix) {
				unsealed = true
			}
			add(seal.Prefix)
			add(*v)
		}
		if unsealed {
			out.Unsealed = append(out.Unsealed, c[0]+"."+c[1])
		}
	}
	for _, q := range []string{
		"SELECT name FROM environments", "SELECT repo FROM environments",
		"SELECT public_id FROM sessions", "SELECT public_id FROM approvals", "SELECT name FROM agents",
	} {
		var vs []string
		if err := db.Raw(q).Scan(&vs).Error; err != nil {
			return out, fmt.Errorf("%s: %w", q, err)
		}
		for _, v := range vs {
			add(v)
		}
	}
	out.Markers = len(markers)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out, err
	}
	for _, e := range entries {
		f := File{Name: e.Name()}
		f.Foreign = !slices.Contains([]string{base, base + "-wal", base + "-shm"}, e.Name())
		if f.Foreign {
			out.Foreign = append(out.Foreign, e.Name())
		}
		if e.Type().IsRegular() {
			b, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				return out, err
			}
			f.Size = int64(len(b))
			f.Plain = plainHeader(b)
			for _, m := range markers {
				if bytes.Contains(b, m) {
					f.Found++
				}
			}
		}
		if f.Plain {
			out.Plain = append(out.Plain, e.Name())
		}
		out.Found += f.Found
		out.Files = append(out.Files, f)
	}
	out.OK = out.Found == 0 && len(out.Plain) == 0 && len(out.Foreign) == 0 && len(out.Unsealed) == 0
	return out, nil
}

// SQLite's 16-byte file header, or a WAL's magic in either byte order.
func plainHeader(b []byte) bool {
	return bytes.HasPrefix(b, []byte("SQLite format 3\x00")) ||
		bytes.HasPrefix(b, []byte{0x37, 0x7f, 0x06, 0x82}) || bytes.HasPrefix(b, []byte{0x37, 0x7f, 0x06, 0x83})
}
