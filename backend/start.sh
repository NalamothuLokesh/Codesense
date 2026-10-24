#!/usr/bin/env bash
set -e

# Always run from the backend directory
cd "$(dirname "$0")"

echo "============================================="
echo "   CodeSense Dual Service Startup (Render)   "
echo "============================================="

# Detect Python binary
if command -v python3 &>/dev/null; then
    PY="python3"
elif command -v python &>/dev/null; then
    PY="python"
elif [ -f "../.venv/bin/python" ]; then
    PY="../.venv/bin/python"
elif [ -f ".venv/bin/python" ]; then
    PY=".venv/bin/python"
else
    echo "[ERROR] No Python interpreter found in PATH"
    exit 1
fi

echo "[start.sh] Python binary: $PY ($($PY --version 2>&1))"
echo "[start.sh] Node binary:   $(node --version 2>&1)"

# Start Python AI Chat Service in background on port 8000
echo "[start.sh] Starting Python AI Chat Service (port 8000)..."
$PY chat_service.py &
CHAT_PID=$!
echo "[start.sh] AI Chat Service launched with PID: $CHAT_PID"

# Ensure cleanup on process exit
cleanup() {
    echo "[start.sh] Terminating AI Chat Service (PID $CHAT_PID)..."
    kill -TERM "$CHAT_PID" 2>/dev/null || true
    wait "$CHAT_PID" 2>/dev/null || true
}
trap cleanup SIGINT SIGTERM EXIT

# Start Node backend on PORT (Render provides PORT, default 4000)
echo "[start.sh] Starting Node Backend on port ${PORT:-4000}..."
exec node server.js
