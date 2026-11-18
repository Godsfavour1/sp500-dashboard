#!/usr/bin/env bash
# Serve the dashboard locally at http://localhost:8000 (Ctrl+C to stop).
#
# Usage:
#   bash scripts/serve.sh          # port 8000
#   bash scripts/serve.sh 8765     # another port
cd "$(dirname "$0")/.."
PORT="${1:-8000}"
echo "Open http://localhost:$PORT/  (add #AAPL to jump to a stock)"
python -m http.server "$PORT" -d docs
