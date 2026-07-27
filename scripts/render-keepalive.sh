#!/usr/bin/env bash
# Ping Render services to prevent free-tier spin-down (~15 min inactivity).
# Usage:
#   RENDER_PING_URLS="https://backend.onrender.com/health,https://front.onrender.com" ./scripts/render-keepalive.sh
# Or export RENDER_PING_URLS in cron / cron-job.org.

set -euo pipefail

URLS="${RENDER_PING_URLS:-}"

if [ -z "$URLS" ]; then
  echo "Error: set RENDER_PING_URLS (comma-separated URLs)." >&2
  echo 'Example: RENDER_PING_URLS="https://sesame-backend-taoc.onrender.com/health,https://encadreur-connect.onrender.com"' >&2
  exit 1
fi

IFS=',' read -ra TARGETS <<< "$URLS"

for raw in "${TARGETS[@]}"; do
  url="$(echo "$raw" | xargs)"
  [ -z "$url" ] && continue

  echo "Pinging $url ..."
  if curl -fsS -o /dev/null -w "  -> HTTP %{http_code}\n" --max-time 30 "$url"; then
    echo "  OK"
  else
    echo "  FAILED (service may be waking up — retry in ~1 min)" >&2
  fi
done

echo "Done at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
