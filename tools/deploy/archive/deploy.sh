#!/usr/bin/env bash
set -euo pipefail

# Atomic FTP/rsync deploy script (blue-green style)
# Requires env: FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_DIR
# Usage: FTP_HOST=... FTP_USER=... FTP_PASS=... ./scripts/deploy.sh

REMOTE_DIR="${FTP_REMOTE_DIR:-/www/site}"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
TMP_DIR="${REMOTE_DIR}_release_${TIMESTAMP}"
CURRENT_SYMLINK="${REMOTE_DIR}_current"

echo "Uploading to temporary remote directory: $TMP_DIR"

# Use lftp if available for FTP or rsync for SSH/SFTP
if command -v lftp >/dev/null 2>&1; then
  echo "Using lftp to mirror site to remote temp dir"
  lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" <<EOF
mkdir -p $TMP_DIR
mirror -R --delete --parallel=4 ./ $TMP_DIR
quit
EOF
else
  echo "lftp not found; expecting rsync over SSH (set SSH_* env accordingly)"
  rsync -avz --delete ./ "$FTP_USER@$FTP_HOST:$TMP_DIR"
fi

# On remote, swap atomically
echo "Activating new release"
if command -v lftp >/dev/null 2>&1; then
  lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" <<EOF
# remove previous backup
if [ -d ${REMOTE_DIR}_previous ]; then rm -rf ${REMOTE_DIR}_previous; fi
if [ -d ${CURRENT_SYMLINK} ]; then mv ${CURRENT_SYMLINK} ${REMOTE_DIR}_previous; fi
mv $TMP_DIR $CURRENT_SYMLINK
# optionally move symlink to live path
if [ -d $REMOTE_DIR ]; then rm -rf $REMOTE_DIR; fi
mv $CURRENT_SYMLINK $REMOTE_DIR
quit
EOF
else
  ssh "$FTP_USER@$FTP_HOST" <<'SSH'
set -e
if [ -d ${REMOTE_DIR}_previous ]; then rm -rf ${REMOTE_DIR}_previous; fi
if [ -d ${CURRENT_SYMLINK} ]; then mv ${CURRENT_SYMLINK} ${REMOTE_DIR}_previous; fi
mv $TMP_DIR $CURRENT_SYMLINK || exit 1
if [ -d $REMOTE_DIR ]; then rm -rf $REMOTE_DIR; fi
mv $CURRENT_SYMLINK $REMOTE_DIR
SSH
fi

echo "Deploy complete. New release activated at $REMOTE_DIR"
