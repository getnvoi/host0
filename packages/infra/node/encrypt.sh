#!/bin/sh
# Secrets encrypted at rest in k3s's datastore. A server that started without it is switched on and every secret
# rewritten through the apiserver, which encrypts it. Idempotent.
set -eu

# k3s answers "see server log for details: ... error ID N"; the sentence is in the journal under that id.
explain() {
  id=$(printf '%s' "$1" | sed -n 's/.*error ID \([0-9][0-9]*\).*/\1/p')
  [ -n "$id" ] && journalctl -u k3s --no-pager | grep "$id" | tail -3 >&2
  printf '%s\n' "$1" >&2
}

# The encryption controller answers some seconds after the node is Ready.
status() {
  for i in $(seq 20); do
    if out=$(k3s secrets-encrypt status 2>&1); then
      printf '%s' "$out"
      return 0
    fi
    echo "secrets-encrypt status, attempt $i: $out" >&2
    sleep 3
  done
  explain "$out"
  return 1
}

run() {
  if ! out=$(k3s secrets-encrypt "$@" 2>&1); then
    explain "$out"
    return 1
  fi
  printf '%s\n' "$out"
}

s=$(status)
case "$s" in
*"Encryption Status: Enabled"*) echo "secrets encryption: enabled"; exit 0 ;;
esac
echo "$s"
run enable
systemctl restart k3s
for _ in $(seq 100); do
  k3s kubectl get --raw /readyz >/dev/null 2>&1 && break
  sleep 3
done
k3s kubectl get --raw /readyz >/dev/null
run reencrypt --force --skip
for _ in $(seq 100); do
  s=$(status)
  case "$s" in
  *"Current Rotation Stage: reencrypt_finished"*) echo "secrets encryption: enabled, every secret rewritten"; exit 0 ;;
  esac
  sleep 3
done
echo "$s" >&2
echo "secrets were not rewritten encrypted in 300s" >&2
exit 1
