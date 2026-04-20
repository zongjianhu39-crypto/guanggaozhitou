#!/usr/bin/env bash
# 一键重启本地静态服务器（用于开发测试）
# 用法：
#   bash start.sh
#   或
#   ./start.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/serve.log"
PORT=3000

echo "[start.sh] project root: ${ROOT_DIR}"
echo "[start.sh] log: ${LOG_FILE}"

cd "${ROOT_DIR}"

# Kill any process listening on PORT
if lsof -i :${PORT} >/dev/null 2>&1; then
  echo "[start.sh] killing existing process on port ${PORT}..."
  kill $(lsof -ti :${PORT}) 2>/dev/null || true
  sleep 1
fi

echo "[start.sh] starting static server on port ${PORT} (nohup)..."
nohup npx --yes serve -l ${PORT} . > "${LOG_FILE}" 2>&1 &


# 等待并重试检测端口（最多 6 次，每次间隔 1 秒）
MAX_RETRIES=6
count=0
while [ $count -lt $MAX_RETRIES ]; do
  # 使用更严格的 TCP LISTEN 检测
  if lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start.sh] OK: server is listening on port ${PORT} (after $count retries)"
    echo "[start.sh] tail of log (${LOG_FILE}):"
    tail -n 20 "${LOG_FILE}"
    break
  fi
  count=$((count+1))
  sleep 1
done

if [ $count -ge $MAX_RETRIES ]; then
  echo "[start.sh] ERROR: server not listening on port ${PORT} after ${MAX_RETRIES} attempts. Check ${LOG_FILE} for details." >&2
  echo "[start.sh] last 100 lines of log:" 
  tail -n 100 "${LOG_FILE}"
  exit 1
fi

echo "[start.sh] Done. Visit http://localhost:${PORT}/index.html"
