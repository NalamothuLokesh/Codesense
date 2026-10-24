#!/usr/bin/env bash
set -e

# Always run from the backend directory
cd "$(dirname "$0")"

echo "============================================="
echo "   CodeSense Backend Startup (Render)        "
echo "============================================="

echo "[start.sh] Node binary: $(node --version 2>&1)"

# Start Node backend on PORT (Render provides PORT, default 4000)
# Node server.js automatically supervises and runs chat_service.py on port 8000
echo "[start.sh] Starting Node Backend on port ${PORT:-4000}..."
exec node server.js
