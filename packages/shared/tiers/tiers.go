// Sandbox sizes. A tier is a worker pool: the actor may use CPU and Memory, the worker reserves CPURequest and all of
// Memory, since memory cannot be overcommitted and CPU can.
package tiers

import (
	"fmt"
	"strings"
)

// Every pool starts empty; the plane grows it when an actor finds no worker and shrinks it to what holds one.
type Tier struct {
	Name       string `json:"name"`
	CPU        string `json:"cpu"`
	Memory     string `json:"memory"`
	CPURequest string `json:"cpuRequest"`
	// The tier of an environment that names none; exactly one tier is.
	Default bool `json:"default,omitempty"`
}

// The tiers of a cluster whose file declares none.
var Defaults = []Tier{
	{Name: "small", CPU: "1", Memory: "2Gi", CPURequest: "250m"},
	{Name: "medium", CPU: "2", Memory: "4Gi", CPURequest: "500m", Default: true},
	{Name: "large", CPU: "4", Memory: "8Gi", CPURequest: "1"},
}

func (t Tier) Pool() string { return "hz-" + t.Name }

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
