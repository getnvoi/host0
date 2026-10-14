#!/bin/sh
# Secrets encrypted at rest in k3s's datastore. A server that started without it is switched on and every secret
# rewritten through the apiserver, which encrypts it. Idempotent.
set -eu

status=$(k3s secrets-encrypt status)
case "$status" in
*"Encryption Status: Enabled"*) echo "secrets encryption: enabled"; exit 0 ;;
esac
echo "$status"
k3s secrets-encrypt enable
systemctl restart k3s
for _ in $(seq 100); do
  k3s kubectl get --raw /readyz >/dev/null 2>&1 && break
  sleep 3
done
k3s kubectl get --raw /readyz >/dev/null
k3s secrets-encrypt reencrypt --force --skip
for _ in $(seq 100); do
  status=$(k3s secrets-encrypt status)
  case "$status" in
  *"Current Rotation Stage: reencrypt_finished"*) echo "secrets encryption: enabled, every secret rewritten"; exit 0 ;;
  esac
  sleep 3
done
echo "$status" >&2
echo "secrets were not rewritten encrypted in 300s" >&2
exit 1
