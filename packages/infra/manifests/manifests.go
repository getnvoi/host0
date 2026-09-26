// The cluster's own manifests, rendered with the install's values.
package manifests

import (
	"bytes"
	"embed"
	"text/template"
)

//go:embed *.yaml
var files embed.FS

var tmpl = template.Must(template.New("").Delims("[[", "]]").ParseFS(files, "*.yaml"))

func Render(name string, data any) (string, error) {
	var b bytes.Buffer
	err := tmpl.ExecuteTemplate(&b, name, data)
	return b.String(), err
}
