package workspace

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/getnvoi/host0/internal/db"
	"github.com/getnvoi/host0/internal/sandbox"
)

// The way in of a preview host; NotFound when the plane routes it nowhere.
func (ws *Workspace) Route(host string) (sandbox.Route, error) {
	var row db.Route
	err := ws.DB.Where("host = ?", host).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return sandbox.Route{}, NotFound{fmt.Errorf("no route for %s", host)}
	}
	if err != nil {
		return sandbox.Route{}, fmt.Errorf("route %s: %w", host, err)
	}
	return sandbox.Route{Actor: row.Actor, Port: row.Port, Tier: row.Tier}, nil
}

// Routes host to rt, on the plane and then on the edge.
func (ws *Workspace) route(ctx context.Context, host string, rt sandbox.Route) error {
	if err := ws.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "host"}},
		DoUpdates: clause.AssignmentColumns([]string{"actor", "port", "tier"})}).
		Create(&db.Route{Host: host, Actor: rt.Actor, Port: rt.Port, Tier: rt.Tier}).Error; err != nil {
		return fmt.Errorf("route %s: %w", host, err)
	}
	if err := ws.Edge.Route(ctx, host); err != nil {
		return err
	}
	if ws.Published == nil {
		return nil
	}
	return ws.Published(ctx, host)
}

// Routes host nowhere; a host already routed nowhere is no error.
func (ws *Workspace) unroute(host string) error {
	if err := ws.DB.Where("host = ?", host).Delete(&db.Route{}).Error; err != nil {
		return fmt.Errorf("unroute %s: %w", host, err)
	}
	return nil
}
