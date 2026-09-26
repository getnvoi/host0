package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var registry = &http.Client{Timeout: 30 * time.Second}

// Substrate takes images by digest only. A Docker Hub tag is resolved to the digest it names now.
func PinDockerHub(ctx context.Context, image string) (string, error) {
	if strings.Contains(image, "@sha256:") {
		return image, nil
	}
	name, tag := image, "latest"
	if i := strings.LastIndex(image, ":"); i > strings.LastIndex(image, "/") {
		name, tag = image[:i], image[i+1:]
	}
	repo := strings.TrimPrefix(name, "docker.io/")
	if !strings.Contains(repo, "/") {
		repo = "library/" + repo
	}
	if strings.Contains(strings.Split(repo, "/")[0], ".") {
		return "", fmt.Errorf("%s: only Docker Hub tags are resolved; pin it by digest", image)
	}
	req, _ := http.NewRequestWithContext(ctx, "GET",
		"https://auth.docker.io/token?service=registry.docker.io&scope=repository:"+repo+":pull", nil)
	res, err := registry.Do(req)
	if err != nil {
		return "", err
	}
	var tok struct{ Token string }
	json.NewDecoder(res.Body).Decode(&tok)
	res.Body.Close()
	req, _ = http.NewRequestWithContext(ctx, "HEAD", "https://registry-1.docker.io/v2/"+repo+"/manifests/"+tag, nil)
	req.Header.Set("Authorization", "Bearer "+tok.Token)
	req.Header.Set("Accept", strings.Join([]string{"application/vnd.oci.image.index.v1+json",
		"application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.oci.image.manifest.v1+json",
		"application/vnd.docker.distribution.manifest.v2+json"}, ","))
	if res, err = registry.Do(req); err != nil {
		return "", err
	}
	res.Body.Close()
	digest := res.Header.Get("Docker-Content-Digest")
	if res.StatusCode != 200 || digest == "" {
		return "", fmt.Errorf("%s: registry answered %s", image, res.Status)
	}
	return "docker.io/" + repo + "@" + digest, nil
}
