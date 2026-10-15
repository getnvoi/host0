package db

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"github.com/getnvoi/host0/internal/shared/seal"
)

// Sealed stores a column as seal's "h0-sealed:1:" text: a string as its bytes, anything else as its JSON. Only a
// secret is sealed: SQL can neither search nor compare a sealed column.
type Sealed struct{}

func init() { schema.RegisterSerializer("sealed", Sealed{}) }

type keyCtx struct{}

// useKey puts each statement's sealing key in its context, where Sealed finds it; one key per *gorm.DB.
func useKey(db *gorm.DB, key []byte) error {
	set := func(tx *gorm.DB) {
		tx.Statement.Context = context.WithValue(tx.Statement.Context, keyCtx{}, key)
	}
	cb := db.Callback()
	for _, err := range []error{
		cb.Create().Before("gorm:create").Register("h0:key", set),
		cb.Query().Before("gorm:query").Register("h0:key", set),
		cb.Update().Before("gorm:update").Register("h0:key", set),
		cb.Row().Before("gorm:row").Register("h0:key", set),
		cb.Raw().Before("gorm:raw").Register("h0:key", set),
	} {
		if err != nil {
			return err
		}
	}
	return nil
}

func keyOf(ctx context.Context, f *schema.Field) ([]byte, error) {
	k, _ := ctx.Value(keyCtx{}).([]byte)
	if k == nil {
		return nil, fmt.Errorf("%s.%s: no sealing key on this statement; open the database with db.Open", f.Schema.Table, f.DBName)
	}
	return k, nil
}

func (Sealed) Value(ctx context.Context, f *schema.Field, _ reflect.Value, v any) (any, error) {
	key, err := keyOf(ctx, f)
	if err != nil {
		return nil, err
	}
	var plain []byte
	if s, ok := v.(string); ok {
		plain = []byte(s)
	} else if plain, err = json.Marshal(v); err != nil {
		return nil, fmt.Errorf("%s.%s: %w", f.Schema.Table, f.DBName, err)
	}
	out, err := seal.Seal(key, plain)
	if err != nil {
		return nil, fmt.Errorf("%s.%s: %w", f.Schema.Table, f.DBName, err)
	}
	return string(out), nil
}

func (Sealed) Scan(ctx context.Context, f *schema.Field, dst reflect.Value, dbValue any) error {
	if dbValue == nil {
		f.ReflectValueOf(ctx, dst).Set(reflect.Zero(f.FieldType))
		return nil
	}
	var raw []byte
	switch v := dbValue.(type) {
	case string:
		raw = []byte(v)
	case []byte:
		raw = v
	default:
		return fmt.Errorf("%s.%s: a sealed column holds text, not %T", f.Schema.Table, f.DBName, dbValue)
	}
	key, err := keyOf(ctx, f)
	if err != nil {
		return err
	}
	plain, err := seal.Open(key, raw)
	if err != nil {
		return fmt.Errorf("%s.%s: %w", f.Schema.Table, f.DBName, err)
	}
	out := reflect.New(f.FieldType)
	if f.FieldType.Kind() == reflect.String {
		out.Elem().SetString(string(plain))
	} else if err := json.Unmarshal(plain, out.Interface()); err != nil {
		return fmt.Errorf("%s.%s: opens, but is not JSON: %w", f.Schema.Table, f.DBName, err)
	}
	f.ReflectValueOf(ctx, dst).Set(out.Elem())
	return nil
}
