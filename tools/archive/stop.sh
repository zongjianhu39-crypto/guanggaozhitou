#!/usr/bin/env bash
# 优雅停止本地静态服务器（用于开发测试）
# 用法：
#   bash stop.sh
#   或
#   ./stop.sh

set -euo pipefail

PORT=3000

echo "[stop.sh] stopping process listening on port ${PORT}..."
if lsof -i :${PORT} >/dev/null 2>&1; then
  PIDS=$(lsof -ti :${PORT})
  echo "[stop.sh] killing PIDs: ${PIDS}"
  kill ${PIDS} 2>/dev/null || true
  sleep 1
  if lsof -i :${PORT} >/dev/null 2>&1; then
    echo "[stop.sh] some processes remain, forcing kill..."
    kill -9 ${PIDS} 2>/dev/null || true
  fi
  echo "[stop.sh] stopped."
else
  echo "[stop.sh] no process listening on port ${PORT}."
fi
