#!/usr/bin/env bash
# Repository scan to detect hard-coded secrets and deployment credentials.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

echo "Scanning repo for hard-coded secrets..."

PATTERNS=(
  'ftp://[^<"'"'"']+:[^@<"'"'"']+@'
  'eyJ[a-zA-Z0-9_-]{20,}'
  'sb_secret_[A-Za-z0-9_-]{20,}'
  'sk-[A-Za-z0-9]{20,}'
  'PRIVATE KEY-----'
  'ghp_[A-Za-z0-9]{36}'
  'xoxb-[0-9]{10,}'
)

for pattern in "${PATTERNS[@]}"; do
  rg -n --pcre2 \
    --glob '!assets/js/config.js' \
    --glob '!.env.local' \
    --glob '!scripts/.deploy.env' \
    --glob '!tools/checks/check-no-keys.sh' \
    --glob '!**/*.png' \
    --glob '!**/*.jpg' \
    --glob '!**/*.svg' \
    --glob '!**/.git/**' \
    "$pattern" \
    "$ROOT_DIR" >> "$TMP_FILE" || true
done

if [[ -s "$TMP_FILE" ]]; then
  echo "Found potential secrets:"
  sort -u "$TMP_FILE"
  exit 1
fi

echo "Secret scan passed."
