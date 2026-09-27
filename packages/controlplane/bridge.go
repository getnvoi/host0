package controlplane

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// The page around a preview cannot see into it: the preview is another origin. Every HTML page the preview serves
// loads this script, which talks to the web UI only.
//
// Out, hz:url: the path, the title, and whether the frame can go back or forward, on start, on load, on each
// history change, and in answer to hz:ping (with its id), which is how the UI learns a page carries the script.
// In: hz:history (back or forward), hz:navigate (a path) and hz:reload, which a cross-origin parent cannot do.
const bridgePath = "/__hz/bridge.js"

func bridgeScript(appHost string) string {
	return fmt.Sprintf(`(function(){
if (window.top === window.self) return;
var O = %q;
function post(reason, id) {
  var n = window.navigation;
  parent.postMessage({type: "hz:url", reason: reason, id: id, title: document.title,
    path: location.pathname + location.search + location.hash,
    back: n ? n.canGoBack : history.length > 1, forward: n ? n.canGoForward : false}, O);
}
post("start");
addEventListener("load", function () { post("load"); });
addEventListener("popstate", function () { post("popstate"); });
addEventListener("hashchange", function () { post("hashchange"); });
var push = history.pushState, replace = history.replaceState;
history.pushState = function () { push.apply(this, arguments); post("pushState"); };
history.replaceState = function () { replace.apply(this, arguments); post("replaceState"); };
addEventListener("message", function (e) {
  if (e.origin !== O || !e.data) return;
  var d = e.data;
  if (d.type === "hz:history" && typeof d.delta === "number") history.go(d.delta);
  if (d.type === "hz:navigate" && typeof d.path === "string" && d.path.charAt(0) === "/") location.assign(d.path);
  if (d.type === "hz:reload") location.reload();
  if (d.type === "hz:ping") post("ping", d.id);
});
})();
`, origin(appHost))
}

func serveBridge(w http.ResponseWriter, appHost string) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	io.WriteString(w, bridgeScript(appHost))
}

// Adds the bridge's script tag after <head>, or ahead of everything when the first 64 KiB hold no <head>.
func bridged(res *http.Response) {
	if res.Request == nil || !document(res.Request) || res.StatusCode == http.StatusSwitchingProtocols ||
		!strings.Contains(res.Header.Get("Content-Type"), "text/html") || res.Header.Get("Content-Encoding") != "" {
		return
	}
	res.Body = &injector{src: res.Body, tag: []byte(`<script src="` + bridgePath + `"></script>`)}
	res.Header.Del("Content-Length")
	res.ContentLength = -1
}

type injector struct {
	src  io.ReadCloser
	tag  []byte
	out  []byte
	done bool
}

const scan = 64 << 10

func (i *injector) Read(p []byte) (int, error) {
	if !i.done {
		i.done = true
		head := make([]byte, 0, 4096)
		buf := make([]byte, 4096)
		at := -1
		for len(head) < scan {
			n, err := i.src.Read(buf)
			head = append(head, buf[:n]...)
			if at = after(head, "<head"); at >= 0 || err != nil {
				break
			}
		}
		if at < 0 {
			at = 0
		}
		i.out = append(append(append([]byte{}, head[:at]...), i.tag...), head[at:]...)
	}
	if len(i.out) > 0 {
		n := copy(p, i.out)
		i.out = i.out[n:]
		return n, nil
	}
	return i.src.Read(p)
}

func (i *injector) Close() error { return i.src.Close() }

// The index just past the tag that opens name, case-insensitive; -1 when it is not all there yet.
func after(b []byte, name string) int {
	lower := bytes.ToLower(b)
	for from := 0; ; {
		j := bytes.Index(lower[from:], []byte(name))
		if j < 0 {
			return -1
		}
		j += from
		end := j + len(name)
		if end < len(b) && (b[end] == '>' || b[end] == ' ' || b[end] == '\t' || b[end] == '\n' || b[end] == '\r') {
			k := bytes.IndexByte(b[end:], '>')
			if k < 0 {
				return -1
			}
			return end + k + 1
		}
		from = end
	}
}
