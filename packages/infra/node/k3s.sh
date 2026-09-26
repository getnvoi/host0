#!/bin/sh
# k3s on a node of the cluster: the server on the control node, an agent on a worker. Idempotent.
set -eu

K3S_VERSION="v1.36.4+k3s1"
K3S_INSTALL_SHA256="e5cc3b3d9dfc1662c2d9be6da5abc9a4cd317d6abc3a5ffc02e3dd3248207fee"
GATES="ClusterTrustBundle=true,ClusterTrustBundleProjection=true,PodCertificateRequest=true"

ip=""
for _ in $(seq 60); do
  ip=$(ip -4 -o addr show to {{.NetRange}} | awk '{print $4}' | cut -d/ -f1 | head -1)
  [ -n "$ip" ] && break
  sleep 2
done
[ -n "$ip" ] || { echo "no address in {{.NetRange}}" >&2; exit 1; }
iface=$(ip -4 -o addr show to {{.NetRange}} | awk '{print $2}' | head -1)

echo "net.ipv4.conf.all.proxy_arp=1" > /etc/sysctl.d/90-nvoi.conf
sysctl -q -p /etc/sysctl.d/90-nvoi.conf

mkdir -p /etc/rancher/k3s
cat > /etc/rancher/k3s/registries.yaml <<EOF
mirrors:
  "{{.LocalRegistry}}":
    endpoint: ["http://{{.Registry}}"]
EOF

{{if eq .Role "server"}}
cat > /etc/rancher/k3s/config.yaml <<EOF
node-ip: $ip
advertise-address: $ip
flannel-iface: $iface
tls-san: [$ip]
secrets-encryption: true
disable: [traefik, servicelb]
disable-cloud-controller: true
write-kubeconfig-mode: "0600"
kube-apiserver-arg:
  - feature-gates=$GATES
  - runtime-config=certificates.k8s.io/v1beta1=true
kube-controller-manager-arg:
  - feature-gates=ClusterTrustBundle=true,PodCertificateRequest=true
kubelet-arg:
  - cloud-provider=external
  - feature-gates=$GATES
EOF
{{else}}
cat > /etc/rancher/k3s/config.yaml <<EOF
server: https://{{.ControlIP}}:6443
token: {{.Token}}
node-ip: $ip
flannel-iface: $iface
node-label: [{{range $i, $l := .Labels}}{{if $i}}, {{end}}{{$l}}{{end}}]
node-taint: [ate.dev/sandboxClass=gvisor:NoSchedule]
kubelet-arg:
  - cloud-provider=external
  - feature-gates=$GATES
EOF
{{end}}

if ! systemctl is-active --quiet k3s{{if ne .Role "server"}}-agent{{end}}; then
  installer=$(mktemp)
  curl -sfL https://get.k3s.io -o "$installer"
  got=$(sha256sum "$installer" | cut -d' ' -f1)
  [ "$got" = "$K3S_INSTALL_SHA256" ] || { echo "k3s installer is $got, pinned to $K3S_INSTALL_SHA256" >&2; exit 1; }
  INSTALL_K3S_VERSION="$K3S_VERSION" INSTALL_K3S_EXEC="{{.Role}}" sh "$installer"
  rm -f "$installer"
fi
