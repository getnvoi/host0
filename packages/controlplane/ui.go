package controlplane

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/getnvoi/nvoi/controlplane/web"
)

var dist, _ = fs.Sub(web.Dist, "dist")

// Files by path; every other path is the app's own route and gets index.html. Hashed assets are cached for good.
func serveUI(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" && name != "index.html" {
		if f, err := dist.Open(name); err == nil {
			f.Close()
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.FileServerFS(dist).ServeHTTP(w, r)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-cache")
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		http.Error(w, "The UI is not built into this plane: bun run build in packages/ui, then rebuild.", http.StatusNotImplemented)
		return
	}
	http.ServeFileFS(w, r, dist, "index.html")
}
