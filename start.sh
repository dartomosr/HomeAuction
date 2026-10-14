#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Node.js and npm are required.' >&2
  exit 1
fi
if [[ ! -d node_modules/socket.io ]]; then
  npm ci
fi
node server.js &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
  if [[ -n "${tunnel_pid:-}" ]]; then kill "$tunnel_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM
sleep 2
echo 'Local: http://localhost:3000'
echo 'Cloudflare will print the external HTTPS URL below.'
npx cloudflared tunnel --url http://localhost:3000 &
tunnel_pid=$!
wait -n "$server_pid" "$tunnel_pid"
