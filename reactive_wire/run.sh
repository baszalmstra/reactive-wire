#!/usr/bin/env bash
set -euo pipefail

if [ -f /usr/lib/bashio/bashio ]; then
  # shellcheck disable=SC1091
  . /usr/lib/bashio/bashio
  LOG_LEVEL="$(bashio::config 'log_level')"
else
  LOG_LEVEL="${RW_LOG_LEVEL:-info}"
fi

export HA_URL="${HA_URL:-ws://supervisor/core/websocket}"
export HA_TOKEN="${HA_TOKEN:-${SUPERVISOR_TOKEN:-}}"
export RW_HOST="${RW_HOST:-0.0.0.0}"
export RW_PORT="${RW_PORT:-7420}"
export RW_DATA_DIR="${RW_DATA_DIR:-/data}"
export RW_STATIC_DIR="${RW_STATIC_DIR:-/app/frontend}"
export RW_TRUSTED_INGRESS="${RW_TRUSTED_INGRESS:-1}"
export RW_LOG_LEVEL="${LOG_LEVEL:-info}"

if [ -z "${HA_TOKEN}" ]; then
  echo "SUPERVISOR_TOKEN/HA_TOKEN is not available; enable homeassistant_api in the add-on config" >&2
  exit 1
fi

exec node /app/server/src/server/index.js
