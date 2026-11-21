#!/bin/sh
set -eu

SECRET_FILE="${TURN_SHARED_SECRET_FILE:-/run/secrets/turn_shared_secret}"
RUNTIME_DIR="${TURN_RUNTIME_DIR:-/run/coturn}"
CONF_FILE="${RUNTIME_DIR}/turnserver.conf"
REALM="${TURN_REALM:-bifrost.local}"
PROFILE="${TURN_NETWORK_PROFILE:-local}"
EXTERNAL_IP="${TURN_EXTERNAL_IP:-}"

if [ ! -f "$SECRET_FILE" ] || [ ! -r "$SECRET_FILE" ]; then
  echo "coturn: TURN shared secret file is missing or unreadable." >&2
  exit 1
fi

LINE_COUNT=$(wc -l < "$SECRET_FILE" | tr -d '[:space:]')
IFS= read -r RAW_SECRET < "$SECRET_FILE" || true
SECRET=$(printf '%s' "$RAW_SECRET" | tr -d '\r')

if [ "$LINE_COUNT" -gt 1 ]; then
  echo "coturn: TURN shared secret file must contain a single 64-char hex line." >&2
  exit 1
fi

if [ "$LINE_COUNT" -eq 1 ]; then
  EXTRA_BYTES=$(tail -n +2 "$SECRET_FILE" | wc -c | tr -d '[:space:]')
  if [ "$EXTRA_BYTES" -gt 0 ]; then
    echo "coturn: TURN shared secret file must not contain trailing data." >&2
    exit 1
  fi
fi

# Validate using POSIX sh case pattern so secret never enters external process argv.
case "$SECRET" in
  *[!0-9a-fA-F]*|"")
    echo "coturn: TURN shared secret must be 64 hexadecimal characters." >&2
    exit 1
    ;;
esac

if [ "${#SECRET}" -ne 64 ]; then
  echo "coturn: TURN shared secret must be 64 hexadecimal characters." >&2
  exit 1
fi

case "$REALM" in
  ""|*[!a-zA-Z0-9.-]*)
    echo "coturn: TURN_REALM contains invalid characters." >&2
    exit 1
    ;;
esac

if [ -n "$EXTERNAL_IP" ]; then
  case "$EXTERNAL_IP" in
    *[!0-9a-fA-F.:/,]*)
      echo "coturn: TURN_EXTERNAL_IP contains invalid characters." >&2
      exit 1
      ;;
  esac
fi

if [ "$PROFILE" != "local" ] && [ "$PROFILE" != "production" ]; then
  echo "coturn: TURN_NETWORK_PROFILE must be 'local' or 'production'." >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
umask 077

{
  printf '%s\n' "listening-port=3478"
  printf '%s\n' "min-port=49160"
  printf '%s\n' "max-port=49200"
  printf '%s\n' "fingerprint"
  printf '%s\n' "use-auth-secret"
  printf '%s\n' "static-auth-secret=${SECRET}"
  printf '%s\n' "realm=${REALM}"
  printf '%s\n' "no-cli"
  printf '%s\n' "no-multicast-peers"
  printf '%s\n' "stale-nonce=600"
  printf '%s\n' "user-quota=16"
  printf '%s\n' "total-quota=200"
  printf '%s\n' "max-bps=4194304"
  printf '%s\n' "log-file=stdout"

  # Always block unspecified, link-local / cloud metadata, and multicast/reserved peer ranges.
  printf '%s\n' "denied-peer-ip=0.0.0.0-0.255.255.255"
  printf '%s\n' "denied-peer-ip=169.254.0.0-169.254.255.255"
  printf '%s\n' "denied-peer-ip=224.0.0.0-255.255.255.255"

  # In production, also block loopback and RFC1918/CGNAT/ULA peer targets to prevent internal SSRF pivots.
  # Local profile leaves loopback/RFC1918 open so local multi-tab or LAN tests can relay when required.
  if [ "$PROFILE" = "production" ]; then
    printf '%s\n' "denied-peer-ip=10.0.0.0-10.255.255.255"
    printf '%s\n' "denied-peer-ip=100.64.0.0-100.127.255.255"
    printf '%s\n' "denied-peer-ip=127.0.0.0-127.255.255.255"
    printf '%s\n' "denied-peer-ip=172.16.0.0-172.31.255.255"
    printf '%s\n' "denied-peer-ip=192.168.0.0-192.168.255.255"
    printf '%s\n' "denied-peer-ip=::1"
    printf '%s\n' "denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
    printf '%s\n' "denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
  fi

  if [ -n "$EXTERNAL_IP" ]; then
    printf '%s\n' "external-ip=${EXTERNAL_IP}"
  fi
} > "$CONF_FILE"

chmod 600 "$CONF_FILE"
unset RAW_SECRET SECRET

exec turnserver -n -c "$CONF_FILE"
