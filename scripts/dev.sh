#!/usr/bin/env bash
# Start, stop or inspect the local server in the background.
# Agents and humans use the same entry point:
#   scripts/dev.sh start | stop | status | logs
set -euo pipefail

cd "$(dirname "$0")/.."
# The health check below needs the port the server will use. src/server.js loads
# the rest of .env itself; like it, a PORT already set in the shell wins.
if [[ -z "${PORT:-}" && -f .env ]]; then
  PORT="$(sed -n -E 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*["'\'']?([0-9]+).*/\1/p' .env | tail -n 1)"
fi
PORT="${PORT:-3000}"
STATE_DIR=".dev"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-start}" in
  start)
    if is_running; then
      echo "Already running (pid $(cat "$PID_FILE")) on http://localhost:$PORT"
      exit 0
    fi
    mkdir -p "$STATE_DIR"
    PORT="$PORT" nohup node src/server.js >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    # Wait until the health check answers (up to ~5 seconds).
    for _ in $(seq 1 25); do
      if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
        echo "Started (pid $(cat "$PID_FILE")) on http://localhost:$PORT — logs: $LOG_FILE"
        exit 0
      fi
      sleep 0.2
    done
    echo "Server did not become healthy. Last log lines:" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    exit 1
    ;;
  stop)
    if is_running; then
      kill "$(cat "$PID_FILE")"
      echo "Stopped."
    else
      echo "Not running."
    fi
    rm -f "$PID_FILE"
    ;;
  status)
    if is_running; then
      echo "Running (pid $(cat "$PID_FILE")) on http://localhost:$PORT"
    else
      echo "Not running."
      exit 1
    fi
    ;;
  logs)
    tail -n "${2:-50}" "$LOG_FILE"
    ;;
  *)
    echo "Usage: scripts/dev.sh start|stop|status|logs [lines]" >&2
    exit 2
    ;;
esac
