#!/usr/bin/env bash
# 可靠的 lftp 部署脚本 — 逐文件上传，自动重试，最终验证
# 用法: bash scripts/deploy_lftp.sh [--dry-run]
set -euo pipefail

LOCAL_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE="$LOCAL_DIR/.env.local"
DEPLOY_ENV_FILE="$LOCAL_DIR/scripts/.deploy.env"
MAX_RETRIES=3
RETRY_DELAY=15
DRY_RUN=false

[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

load_env_file() {
  local file_path="$1"
  if [[ -f "$file_path" ]]; then
    # shellcheck disable=SC1090
    source "$file_path"
  fi
}

load_env_file "$ENV_FILE"
load_env_file "$DEPLOY_ENV_FILE"

FTP_HOST="${FTP_HOST:-}"
FTP_USER="${FTP_USER:-}"
FTP_PASS="${FTP_PASS:-}"
REMOTE_ROOT="${REMOTE_ROOT:-/wwwroot}"
SITE_URL="${SITE_URL:-https://www.friends.wang}"

require_env() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    echo "缺少必需环境变量: $key"
    echo "请在 $ENV_FILE 或 $DEPLOY_ENV_FILE 中设置，或在当前 shell 中导出。"
    exit 1
  fi
}

require_env FTP_HOST
require_env FTP_USER
require_env FTP_PASS

# 需要部署的文件列表（相对于项目根目录）
FILES=(
  index.html
  style.css
  script.js
  auth.js
  favicon.svg
  insights.html
  progress.html
  supabase-dashboard.html
  prompt-admin.html
  dashboard.js
  prompt-admin.js
  assets/js/config.js
  assets/js/auth-helpers.js
  assets/data/dashboard-spec.json
  assets/hero-dashboard-scene.svg
  assets/hero-illustration.svg
  assets/hero-image.jpg
  auth/index.html
  auth/feishu/callback.html
)

FAILED=()
SUCCEEDED=()

upload_one() {
  local rel_path="$1"
  local local_file="$LOCAL_DIR/$rel_path"
  local remote_dir
  remote_dir="$REMOTE_ROOT/$(dirname "$rel_path")"
  # Normalize: /wwwroot/. -> /wwwroot
  remote_dir="${remote_dir%/.}"

  if [[ ! -f "$local_file" ]]; then
    echo "  ⚠ 跳过 $rel_path (本地文件不存在)"
    return 1
  fi

  if $DRY_RUN; then
    echo "  [dry-run] $rel_path -> $remote_dir/"
    return 0
  fi

  for attempt in $(seq 1 $MAX_RETRIES); do
    echo "  上传 $rel_path (尝试 $attempt/$MAX_RETRIES)..."
    if lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" -e \
      "set ftp:passive-mode true; set ssl:verify-certificate no; set net:timeout 60; set net:max-retries 2; mkdir -p $remote_dir; put -O $remote_dir $local_file; bye" 2>/dev/null; then
      return 0
    fi
    echo "  ✗ 传输失败，${RETRY_DELAY}秒后重试..."
    # 550 file lock workaround: try deleting the partial file
    lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" -e \
      "set ftp:passive-mode true; set ssl:verify-certificate no; cd $remote_dir; rm -f $(basename "$rel_path"); bye" 2>/dev/null || true
    sleep "$RETRY_DELAY"
  done
  return 1
}

echo "🚀 部署到 $FTP_HOST$REMOTE_ROOT"
echo "   本地目录: $LOCAL_DIR"
echo "   文件数量: ${#FILES[@]}"
$DRY_RUN && echo "   *** DRY RUN 模式 ***"
echo ""

for f in "${FILES[@]}"; do
  if upload_one "$f"; then
    SUCCEEDED+=("$f")
    echo "  ✓ $f"
  else
    FAILED+=("$f")
    echo "  ✗ $f (${MAX_RETRIES}次重试后仍失败)"
  fi
done

echo ""
echo "===== 上传结果 ====="
echo "成功: ${#SUCCEEDED[@]}/${#FILES[@]}"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "失败: ${FAILED[*]}"
fi

# 验证（非 dry-run 模式下）
if ! $DRY_RUN; then
  echo ""
  echo "===== 在线验证 ====="
  VERIFY_FAILED=()
  for f in "${FILES[@]}"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL/$f")
    if [[ "$code" == "200" ]]; then
      printf "  ✓ %-40s %s\n" "$f" "$code"
    else
      printf "  ✗ %-40s %s\n" "$f" "$code"
      VERIFY_FAILED+=("$f")
    fi
  done

  echo ""
  if [[ ${#VERIFY_FAILED[@]} -eq 0 ]]; then
    echo "✅ 全部文件验证通过！网站部署成功。"
  else
    echo "⚠ 以下文件验证失败: ${VERIFY_FAILED[*]}"
    echo "  可尝试重新运行此脚本。"
    exit 1
  fi
fi
