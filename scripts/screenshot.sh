#!/usr/bin/env bash
# Take desktop and phone-width screenshots of the dashboard with headless Edge
# (or Chrome), and report whether the phone layout scrolls sideways.
# The dashboard must already be served (see scripts/serve.sh).
#
# Usage:
#   bash scripts/screenshot.sh                 # http://localhost:8000, AAPL
#   bash scripts/screenshot.sh 8765 MCD        # port 8765, MCD
# Output: screenshots/desktop.png and screenshots/phone.png
set -u
cd "$(dirname "$0")/.."
PORT="${1:-8000}"
TICKER="${2:-AAPL}"
URL="http://localhost:$PORT"

BROWSER=""
for b in "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
         "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
         "/c/Program Files/Google/Chrome/Application/chrome.exe" \
         "$(command -v google-chrome 2>/dev/null)" "$(command -v chromium 2>/dev/null)"; do
  [ -n "$b" ] && [ -x "$b" ] && { BROWSER="$b"; break; }
done
[ -n "$BROWSER" ] || { echo "No Edge or Chrome found."; exit 1; }

mkdir -p screenshots
OUT="$(pwd)/screenshots"
command -v cygpath >/dev/null && OUT="$(cygpath -w "$OUT")"

"$BROWSER" --headless=new --disable-gpu --window-size=1200,1250 --virtual-time-budget=5000 \
  --screenshot="$OUT/desktop.png" "$URL/#$TICKER" 2>/dev/null

# Headless browsers won't go narrower than ~500px, so test phone width in a 380px iframe.
cat > docs/_phone_test.html <<EOF
<body style="margin:0;background:#888"><iframe src="index.html#$TICKER" style="width:380px;height:1400px;border:0;background:#fff"></iframe>
<script>setTimeout(()=>{const d=document.querySelector('iframe').contentDocument;document.title='W'+d.documentElement.scrollWidth;},3000)</script></body>
EOF
"$BROWSER" --headless=new --disable-gpu --window-size=700,1400 --virtual-time-budget=6000 \
  --screenshot="$OUT/phone.png" "$URL/_phone_test.html" 2>/dev/null
W=$("$BROWSER" --headless=new --disable-gpu --virtual-time-budget=6000 --dump-dom "$URL/_phone_test.html" 2>/dev/null | grep -o "<title>W[0-9]*" | grep -o "[0-9]*")
rm -f docs/_phone_test.html

echo "Saved screenshots/desktop.png and screenshots/phone.png"
if [ -n "$W" ] && [ "$W" -le 380 ]; then echo "Phone layout OK (content width ${W}px of 380px)"; else echo "Phone layout may scroll sideways (content width ${W:-unknown}px)"; fi
