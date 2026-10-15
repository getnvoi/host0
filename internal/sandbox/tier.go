package sandbox

import (
	"fmt"
	"strings"
	"time"
)

// A sandbox size, and the worker pool of that size: the actor may use CPU and Memory, the worker reserves CPURequest
// and all of Memory, since memory cannot be overcommitted and CPU can. Every pool starts empty.
type Tier struct {
	Name       string `json:"name"`
	CPU        string `json:"cpu"`
	Memory     string `json:"memory"`
	CPURequest string `json:"cpuRequest"`
	// The tier of an environment that names none; exactly one tier is.
	Default bool `json:"default,omitempty"`
}

// The tiers of a cluster whose file declares none.
var DefaultTiers = []Tier{
	{Name: "small", CPU: "1", Memory: "2Gi", CPURequest: "250m"},
	{Name: "medium", CPU: "2", Memory: "4Gi", CPURequest: "500m", Default: true},
	{Name: "large", CPU: "4", Memory: "8Gi", CPURequest: "1"},
}

func (t Tier) Pool() string { return "h0-" + t.Name }

// The tier named name among all; the default one for "".
func Pick(all []Tier, name string) (Tier, error) {
	var names []string
	for _, t := range all {
		if t.Name == name || name == "" && t.Default {
			return t, nil
		}
		names = append(names, t.Name)
	}
	if name == "" {
		return Tier{}, fmt.Errorf("no default tier among %s", strings.Join(names, ", "))
	}
	return Tier{}, fmt.Errorf("no tier %q: %s", name, strings.Join(names, ", "))
}

// What install declares about the cluster's workers and sizes; the plane holds it as one row.
type Shape struct {
	Workers Servers `json:"workers"`
	Tiers   []Tier  `json:"tiers"`
	Actors  Rest    `json:"actors"`
}

// When the plane rests an idle actor: paused after Pause, suspended after Suspend.
type Rest struct {
	Pause   time.Duration `json:"pause"`
	Suspend time.Duration `json:"suspend"`
}

// The servers the plane creates for worker pools. Type and Location are empty on a cluster with no cloud.
type Servers struct {
	Type     string        `json:"type"`
	Location string        `json:"location"`
	Max      int           `json:"max"`
	Idle     time.Duration `json:"idle"` // a worker with no actor this long is deleted
}
