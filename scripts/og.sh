#!/usr/bin/env bash
# Render the social card (scripts/og-card.html) to assets/img/og.png with headless Chrome.
# Re-run when the logo or wordmark changes.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot="$PWD/assets/img/og.png" "file://$PWD/scripts/og-card.html" 2>/dev/null
echo "wrote assets/img/og.png"
