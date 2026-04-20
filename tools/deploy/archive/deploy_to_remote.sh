#!/usr/bin/env bash
set -euo pipefail

# deploy_to_remote.sh
# 用途：把本地 ~/.openclaw/workspace/website 同步到远端根目录（慎用 --delete），并做备份与权限设置
# 使用：./deploy_to_remote.sh user@host /path/to/remote_root

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 user@host /path/to/remote_root"
  exit 2
fi

REMOTE="$1"
REMOTE_ROOT="$2"
LOCAL_DIR="${LOCAL_DIR:-$HOME/.openclaw/workspace/website/}"
EXCLUDES=( ".git" "node_modules" ".env.local" )

# 构建 rsync exclude 参数
RSYNC_EXCLUDES=()
for e in "${EXCLUDES[@]}"; do
  RSYNC_EXCLUDES+=(--exclude="$e")
done

TIMESTAMP=$(date +%Y%m%d%H%M%S)
BACKUP_DIR="${REMOTE_ROOT}.bak_${TIMESTAMP}"

echo "[deploy] 本地目录: $LOCAL_DIR"
echo "[deploy] 远端: $REMOTE:$REMOTE_ROOT"

read -p "确认将覆盖远端 $REMOTE:$REMOTE_ROOT ? 这会删除远端多余文件。输入 yes 继续：" CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "已取消"
  exit 0
fi

# 1) 远端备份
echo "[deploy] 在远端创建备份: $BACKUP_DIR"
ssh "$REMOTE" "if [ -d '$REMOTE_ROOT' ]; then mv '$REMOTE_ROOT' '$BACKUP_DIR'; else echo '远端目录不存在，跳过备份'; fi"

# 2) 同步（rsync --delete）
echo "[deploy] 开始 rsync 同步（排除: ${EXCLUDES[*]})"
rsync -avz --delete "${RSYNC_EXCLUDES[@]}" "$LOCAL_DIR" "$REMOTE:$REMOTE_ROOT"

# 3) 设置权限（默认 www:www，可根据实际主机用户修改）
echo "[deploy] 设定远端文件权限（请根据需要修改用户组）"
ssh "$REMOTE" "chown -R www:www '$REMOTE_ROOT' || true; find '$REMOTE_ROOT' -type d -exec chmod 755 {} +; find '$REMOTE_ROOT' -type f -exec chmod 644 {} +"

# 4) 重启 Web 服务提示（不是强制命令，按远端环境选择）
cat <<'EOF'
[deploy] 已完成同步。
请根据远端主机类型重启服务，例如：
  # Nginx
  sudo systemctl restart nginx
  # 或 Apache
  sudo systemctl restart apache2
如果是面板（如西部数码面板），请在面板中刷新/发布。
EOF

echo "[deploy] 回滚命令示例（仅供参考）："
echo "ssh $REMOTE 'rm -rf $REMOTE_ROOT && mv $BACKUP_DIR $REMOTE_ROOT'"

echo "[deploy] 完成"
