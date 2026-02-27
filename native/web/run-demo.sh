#!/bin/bash
# Opens the web demo in the default browser.
# No build step needed — pure HTML/Canvas/JS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO_DIR="$SCRIPT_DIR/examples/demo-app"

echo "==> Serving web demo at http://localhost:8080"
echo "    Press Ctrl+C to stop."

cd "$DEMO_DIR"

# Use Python's built-in HTTP server (available on macOS/Linux)
if command -v python3 &>/dev/null; then
    open "http://localhost:8080" 2>/dev/null || true
    python3 -m http.server 8080
elif command -v python &>/dev/null; then
    open "http://localhost:8080" 2>/dev/null || true
    python -m http.server 8080
else
    echo "No python found. Just open $DEMO_DIR/index.html in your browser."
    open "$DEMO_DIR/index.html" 2>/dev/null || xdg-open "$DEMO_DIR/index.html" 2>/dev/null || true
fi
