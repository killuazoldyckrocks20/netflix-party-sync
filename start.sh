#!/usr/bin/env bash
# Netflix Party Sync - One-Click Launcher

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PY="$SCRIPT_DIR/server/server.py"

echo "=========================================================="
echo "🎬 Launching Netflix Party Sync & Video Call Server..."
echo "=========================================================="

if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v /opt/homebrew/bin/python3 &>/dev/null; then
    PYTHON_CMD="/opt/homebrew/bin/python3"
else
    echo "❌ Error: Python 3 not found. Please install Python 3."
    exit 1
fi

echo "Using Python: $PYTHON_CMD"
echo ""
echo "📱 Laptop Browser:  http://localhost:8000"
echo "🎯 Test Simulator:  http://localhost:8000/test_player.html"
echo ""
echo "Extension folder:   $SCRIPT_DIR/extension"
echo "Load it in chrome://extensions -> 'Load unpacked'"
echo "=========================================================="
echo ""

exec "$PYTHON_CMD" "$SERVER_PY"
