package main

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"sync"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/getnvoi/host0/internal/scm"
	"github.com/getnvoi/host0/internal/shared/naming"
)

type WorkspaceView struct {
	Name     string  `json:"name"`
	Plan     string  `json:"plan"`
	Location string  `json:"location"`
	Ready    bool    `json:"ready" doc:"Its plane answers now"`
	Run      *string `json:"run" doc:"The run open on it, else null"`
}

type WorkspaceInput struct {
	Name     string `json:"name" doc:"The cluster's name too: its hosts are app-<name>.<zone>"`
	Plan     string `json:"plan" doc:"An offer's plan"`
	Location string `json:"location" doc:"An offer's location"`
}

type Repositories struct {
	InstallURL   string           `json:"install_url" doc:"Where the GitHub App is installed on more repositories"`
	Repositories []scm.Repository `json:"repositories"`
}

type wsPath struct {
	WS string `path:"ws" doc:"The workspace's name"`
}

// The workspace named in the request's path, if it is the signed-in user's.
func (h *hub) workspace(u User, name string) (Workspace, error) {
	var w Workspace
	err := h.DB.Where("name = ? AND user_id = ?", name, u.ID).First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return w, said(http.StatusNotFound, "You have no workspace %s.", name)
	}
	return w, err
}

// For the routes outside Huma: the signed-in user's workspace in the path.
func (h *hub) workspaceOf(r *http.Request) (Workspace, error) {
	u, err := h.bearer(r)
	if err != nil {
		return Workspace{}, err
	}
	return h.workspace(u, r.PathValue("ws"))
}

func (h *hub) view(ctx context.Context, w Workspace) (WorkspaceView, error) {
	v := WorkspaceView{Name: w.Name, Plan: w.Plan, Location: w.Location}
	var open []Run
	if err := h.DB.Where("workspace_id = ? AND state = ?", w.ID, "running").Find(&open).Error; err != nil {
		return v, err
	}
	if len(open) > 0 {
		id := strconv.Itoa(int(open[0].ID))
		v.Run = &id
	} else {
		v.Ready = h.ready(ctx, w)
	}
	return v, nil
}

func (h *hub) workspaces(a huma.API) {
	huma.Register(a, h.signed(huma.Operation{OperationID: "offer", Method: "GET", Path: "/v1/offer",
		Summary: "The plans and locations a workspace can have, asked of Hetzner now"}),
		func(ctx context.Context, _ *struct{}) (*body[Offer], error) {
			o, err := h.offer(ctx)
			return &body[Offer]{o}, fail(err)
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "workspaces", Method: "GET", Path: "/v1/workspaces",
		Summary: "The signed-in user's workspaces; ready is asked of each plane now"}),
		func(ctx context.Context, _ *struct{}) (*body[[]WorkspaceView], error) {
			var ws []Workspace
			if err := h.DB.Where("user_id = ?", userOf(ctx).ID).Order("name").Find(&ws).Error; err != nil {
				return nil, fail(err)
			}
			out := make([]WorkspaceView, len(ws))
			errs := make([]error, len(ws))
			var wg sync.WaitGroup
			for i, w := range ws {
				wg.Go(func() { out[i], errs[i] = h.view(ctx, w) })
			}
			wg.Wait()
			return &body[[]WorkspaceView]{out}, fail(errors.Join(errs...))
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "workspace-create", Method: "POST", Path: "/v1/workspaces",
		DefaultStatus: 201, Summary: "Create a workspace: a cluster on Hetzner behind the hub's zone, installed as h0 cluster install " +
			"installs one; the answer names the run its stream follows"}),
		func(ctx context.Context, in *struct{ Body WorkspaceInput }) (*body[WorkspaceView], error) {
			w, err := h.create(ctx, userOf(ctx), in.Body)
			if err != nil {
				return nil, fail(err)
			}
			r, err := h.start(w, "install")
			if err != nil {
				return nil, fail(err)
			}
			id := strconv.Itoa(int(r.ID))
			return &body[WorkspaceView]{WorkspaceView{Name: w.Name, Plan: w.Plan, Location: w.Location, Run: &id}}, nil
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "workspace-delete", Method: "DELETE", Path: "/v1/workspaces/{ws}",
		DefaultStatus: 202, Summary: "Destroy the workspace's cluster, as h0 cluster destroy; the workspace goes when the run ends ok"}),
		func(ctx context.Context, in *wsPath) (*body[WorkspaceView], error) {
			w, err := h.workspace(userOf(ctx), in.WS)
			if err != nil {
				return nil, fail(err)
			}
			r, err := h.start(w, "destroy")
			if err != nil {
				return nil, fail(err)
			}
			id := strconv.Itoa(int(r.ID))
			return &body[WorkspaceView]{WorkspaceView{Name: w.Name, Plan: w.Plan, Location: w.Location, Run: &id}}, nil
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "workspace-run", Method: "POST", Path: "/v1/workspaces/{ws}/runs",
		DefaultStatus: 201, Summary: "Install again, from where the last run stopped: every step converges"}),
		func(ctx context.Context, in *wsPath) (*body[struct {
			ID string `json:"id"`
		}], error) {
			w, err := h.workspace(userOf(ctx), in.WS)
			if err != nil {
				return nil, fail(err)
			}
			r, err := h.start(w, "install")
			out := &body[struct {
				ID string `json:"id"`
			}]{}
			out.Body.ID = strconv.Itoa(int(r.ID))
			return out, fail(err)
		})
	huma.Register(a, h.signed(huma.Operation{OperationID: "repositories", Method: "GET", Path: "/v1/workspaces/{ws}/repositories",
		Summary: "What the GitHub App reaches, asked of the workspace's plane with the GitHub token it holds"}),
		func(ctx context.Context, in *wsPath) (*body[Repositories], error) {
			w, err := h.workspace(userOf(ctx), in.WS)
			if err != nil {
				return nil, fail(err)
			}
			rs, err := h.repositories(ctx, w)
			if err != nil {
				return nil, fail(err)
			}
			return &body[Repositories]{Repositories{InstallURL: h.GitHub.installURL(), Repositories: rs}}, nil
		})
}

// A new workspace, or the user's own removed one of that name brought back with its sealing key.
func (h *hub) create(ctx context.Context, u User, in WorkspaceInput) (Workspace, error) {
	if _, err := naming.New(in.Name); err != nil {
		return Workspace{}, said(http.StatusBadRequest, "%v", err)
	}
	if in.Name == h.Reserved {
		return Workspace{}, said(http.StatusConflict, "A workspace is called %s already.", in.Name)
	}
	o, err := h.offer(ctx)
	if err != nil {
		return Workspace{}, err
	}
	if !slices.ContainsFunc(o.Plans, func(p Plan) bool { return p.Name == in.Plan }) {
		return Workspace{}, said(http.StatusBadRequest, "There is no plan %s on offer.", in.Plan)
	}
	if !slices.ContainsFunc(o.Locations, func(l Location) bool { return l.Name == in.Location }) {
		return Workspace{}, said(http.StatusBadRequest, "There is no location %s on offer.", in.Location)
	}
	var w Workspace
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Unscoped().Where("name = ?", in.Name).First(&w).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			w = Workspace{Name: in.Name, UserID: u.ID, Plan: in.Plan, Location: in.Location}
			return tx.Create(&w).Error
		case err != nil:
			return err
		case w.DeletedAt.Valid && w.UserID == u.ID:
			w.Plan, w.Location, w.DeletedAt = in.Plan, in.Location, gorm.DeletedAt{}
			return tx.Unscoped().Model(&w).Select("Plan", "Location", "DeletedAt").Updates(&w).Error
		}
		return said(http.StatusConflict, "A workspace is called %s already.", in.Name)
	})
	return w, err
}
