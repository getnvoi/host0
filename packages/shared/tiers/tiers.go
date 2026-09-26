// Sandbox sizes. A tier is a worker pool: the actor may use CPU and Memory, the worker reserves CPURequest and all of
// Memory, since memory cannot be overcommitted and CPU can.
package tiers

import "fmt"

// Every pool starts empty; the plane grows it when an actor finds no worker and shrinks it to what holds one.
type Tier struct {
	Name, CPU, Memory, CPURequest string
}

const Default = "medium"

var All = []Tier{
	{Name: "small", CPU: "1", Memory: "2Gi", CPURequest: "250m"},
	{Name: "medium", CPU: "2", Memory: "4Gi", CPURequest: "500m"},
	{Name: "large", CPU: "4", Memory: "8Gi", CPURequest: "1"},
}

func (t Tier) Pool() string { return "nvoi-" + t.Name }

func Get(name string) (Tier, error) {
	if name == "" {
		name = Default
	}
	for _, t := range All {
		if t.Name == name {
			return t, nil
		}
	}
	return Tier{}, fmt.Errorf("no tier %q: small, medium or large", name)
}
