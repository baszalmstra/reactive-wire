#!/usr/bin/env bash
set -euo pipefail

read_option() {
  local key="$1"
  local fallback="$2"
  if [ ! -f /data/options.json ]; then
    printf '%s' "$fallback"
    return
  fi
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const [key, fallback] = process.argv.slice(1);
    try {
      const options = JSON.parse(readFileSync("/data/options.json", "utf8"));
      const value = options?.[key];
      process.stdout.write(typeof value === "string" && value.length ? value : fallback);
    } catch {
      process.stdout.write(fallback);
    }
  ' "$key" "$fallback"
}

LOG_LEVEL="$(read_option log_level "${RW_LOG_LEVEL:-info}")"

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
