#!/usr/bin/env bash
# Run fetch_data.py, retrying every 10 minutes if Yahoo is rate-limiting.
#
# Usage (from the project folder, Git Bash on Windows or any Unix shell):
#   bash scripts/fetch_with_retry.sh          # up to 7 attempts
#   bash scripts/fetch_with_retry.sh 3        # up to 3 attempts
set -u
cd "$(dirname "$0")/.."

PY=".venv/Scripts/python"
[ -x "$PY" ] || PY=".venv/bin/python"
[ -x "$PY" ] || PY="python"

ATTEMPTS="${1:-7}"
for i in $(seq 1 "$ATTEMPTS"); do
  echo "Attempt $i of $ATTEMPTS at $(date +%H:%M)"
  if "$PY" -u scripts/fetch_data.py > fetch.log 2>&1; then
    grep -vE "^  (fundamentals|failed)" fetch.log | tail -6
    echo "Done."
    exit 0
  fi
  tail -2 fetch.log
  [ "$i" -lt "$ATTEMPTS" ] && { echo "Waiting 10 minutes..."; sleep 600; }
done
echo "Gave up after $ATTEMPTS attempts. See fetch.log."
exit 1
