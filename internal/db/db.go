// The workspace's database: GORM over SQLite with no cgo, the whole file encrypted by the xts VFS.
package db

import (
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"

	"github.com/ncruces/go-sqlite3"
	"github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
	"github.com/ncruces/go-sqlite3/gormlite"
	_ "github.com/ncruces/go-sqlite3/vfs/xts"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/getnvoi/host0/internal/shared/seal"
)

// The file key is HKDF of the sealing key under this info, so it is never the key Sealed columns use.
const fileInfo = "hz/db/file"

// 64 bytes make the xts VFS use AES-256-XTS.
func fileKey(key []byte) ([]byte, error) { return hkdf.Key(sha256.New, key, nil, fileInfo, 64) }

// Open opens the SQLite file at path, encrypted at rest under a key derived from key, with WAL, foreign keys, a
// busy timeout and FTS5 on every connection. Sealed columns seal under key itself. It does not migrate.
func Open(path string, key []byte) (*gorm.DB, error) {
	if len(key) != seal.Size {
		return nil, fmt.Errorf("open %s: the sealing key is %d bytes, not %d", path, len(key), seal.Size)
	}
	fk, err := fileKey(key)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	pragmas := []string{
		"PRAGMA hexkey='" + hex.EncodeToString(fk) + "'", // a PRAGMA, so the key is not in the URI the VFS hands out
		"PRAGMA temp_store=memory",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=on",
		"PRAGMA journal_mode=wal",
		"PRAGMA synchronous=normal",
	}
	// Immediate: a transaction that reads before it writes waits its turn instead of failing busy.
	conn, err := driver.Open("file:"+(&url.URL{Path: path}).EscapedPath()+"?vfs=xts&_txlock=immediate", func(c *sqlite3.Conn) error {
		for _, p := range pragmas {
			if err := c.Exec(p); err != nil {
				if errors.Is(err, sqlite3.NOTADB) {
					return fmt.Errorf("it does not open with this sealing key, or it is not an hz database: %w", err)
				}
				return err
			}
		}
		return fts5.Register(c)
	})
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	fail := func(err error) (*gorm.DB, error) {
		conn.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	db, err := gorm.Open(gormlite.OpenDB(conn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		return fail(err)
	}
	if err := useKey(db, key); err != nil {
		return fail(err)
	}
	var on int
	if err := db.Raw("PRAGMA foreign_keys").Scan(&on).Error; err != nil {
		return fail(err)
	}
	if on != 1 {
		return fail(errors.New("foreign keys are off after asking for them"))
	}
	return db, nil
}

// Migrate runs every migration not yet recorded; a database holding a migration this binary does not know is refused.
func Migrate(db *gorm.DB) error {
	if err := migrator(db).Migrate(); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
