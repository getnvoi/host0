package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
)

type Offer struct {
	CreditCents int        `json:"credit_cents" doc:"Credit the account starts with; there is no billing yet"`
	Currency    string     `json:"currency"`
	Plans       []Plan     `json:"plans"`
	Locations   []Location `json:"locations"`
}

// A Hetzner dedicated-vCPU server type: the control node's and every worker's.
type Plan struct {
	Name        string `json:"name" doc:"The Hetzner server type"`
	Label       string `json:"label"`
	CPU         int    `json:"cpu" doc:"Dedicated vCPUs"`
	Memory      int    `json:"memory" doc:"GB"`
	HourlyCents int    `json:"hourly_cents" doc:"Hetzner's gross hourly price of one server, in its dearest location, rounded up"`
}

type Location struct {
	Name  string `json:"name"`
	Label string `json:"label"`
}

// The server types and locations, asked of Hetzner now: x86 dedicated vCPUs (ccx), as the install's arch, not deprecated.
func (h *hub) offer(ctx context.Context) (Offer, error) {
	out := Offer{Currency: "EUR", Plans: []Plan{}, Locations: []Location{}}
	var types struct {
		ServerTypes []struct {
			Name         string  `json:"name"`
			Cores        int     `json:"cores"`
			Memory       float64 `json:"memory"`
			CPUType      string  `json:"cpu_type"`
			Architecture string  `json:"architecture"`
			Deprecation  any     `json:"deprecation"`
			Prices       []struct {
				Location    string `json:"location"`
				PriceHourly struct {
					Gross string `json:"gross"`
				} `json:"price_hourly"`
			} `json:"prices"`
		} `json:"server_types"`
	}
	if err := h.hetzner(ctx, "/server_types?per_page=50", &types); err != nil {
		return out, err
	}
	for _, t := range types.ServerTypes {
		if t.CPUType != "dedicated" || t.Architecture != "x86" || t.Deprecation != nil || !strings.HasPrefix(t.Name, "ccx") {
			continue
		}
		dearest := 0.0
		for _, p := range t.Prices {
			v, err := strconv.ParseFloat(p.PriceHourly.Gross, 64)
			if err != nil {
				return out, fmt.Errorf("hetzner: %s's hourly price in %s, %q: %w", t.Name, p.Location, p.PriceHourly.Gross, err)
			}
			dearest = max(dearest, v)
		}
		out.Plans = append(out.Plans, Plan{Name: t.Name, Label: fmt.Sprintf("%s · %d vCPU, %g GB", strings.ToUpper(t.Name), t.Cores, t.Memory),
			CPU: t.Cores, Memory: int(t.Memory), HourlyCents: int(math.Ceil(dearest * 100))})
	}
	slices.SortFunc(out.Plans, func(a, b Plan) int { return a.CPU - b.CPU })
	var locations struct {
		Locations []struct {
			Name    string `json:"name"`
			City    string `json:"city"`
			Country string `json:"country"`
		} `json:"locations"`
	}
	if err := h.hetzner(ctx, "/locations", &locations); err != nil {
		return out, err
	}
	for _, l := range locations.Locations {
		out.Locations = append(out.Locations, Location{Name: l.Name, Label: l.City + ", " + l.Country})
	}
	return out, nil
}

func (h *hub) hetzner(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", h.HetznerAPI+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+h.HetznerToken)
	res, err := outbound.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var e struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		if err := json.NewDecoder(res.Body).Decode(&e); err != nil {
			return fmt.Errorf("hetzner %d on %s, and its answer does not read: %w", res.StatusCode, path, err)
		}
		return fmt.Errorf("hetzner %d on %s: %s (%s)", res.StatusCode, path, e.Error.Message, e.Error.Code)
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("hetzner %s: %w", path, err)
	}
	return nil
}
