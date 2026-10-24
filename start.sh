#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$ROOT_DIR/backend/start.sh" ]; then
    exec bash "$ROOT_DIR/backend/start.sh"
else
    echo "[ERROR] backend/start.sh not found"
    exit 1
fi
