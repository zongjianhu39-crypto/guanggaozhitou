#!/usr/bin/env bash
# Repository scan to detect hard-coded secrets and deployment credentials.
#
# Supabase anon key (role=anon) is PUBLIC by design — it's embedded in frontend
# code on purpose.  Security comes from RLS policies, not from hiding the key.
# Only service_role keys, API secrets, and private credentials are flagged.
#
# Known-safe public values are listed in KNOWN_PUBLIC_ANON_KEYS below and
# automatically excluded from results.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_FILE="$(mktemp)"
FILTERED_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE" "$FILTERED_FILE"' EXIT

echo "Scanning repo for hard-coded secrets..."

if ! command -v rg >/dev/null 2>&1; then
  echo "Secret scan failed: ripgrep (rg) is required but was not found in PATH." >&2
  echo "Install rg locally or make it available in CI before running release checks." >&2
  exit 1
fi

# --- Known public values that are safe to embed in frontend code ---
# Add more anon keys here if you use multiple Supabase projects.
KNOWN_PUBLIC_ANON_KEYS=(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqc2NzaWtpdGhieHV4bWp5anNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5Mjc5ODYsImV4cCI6MjA4OTUwMzk4Nn0.NiFpwmdhIuFtzSBqyTHQGohxf3UR3l5U0wtW06o-9p4'
)

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
  # Run rg from ROOT_DIR so paths are relative and --glob patterns match correctly
  (cd "$ROOT_DIR" && rg -n --pcre2 \
    --glob '!.env.local' \
    --glob '!scripts/.deploy.env' \
    --glob '!tools/checks/check-no-keys.sh' \
    --glob '!**/*.png' \
    --glob '!**/*.jpg' \
    --glob '!**/*.svg' \
    --glob '!**/.git/**' \
    "$pattern" \
    .) >> "$TMP_FILE" || true
done

if [[ ! -s "$TMP_FILE" ]]; then
  echo "Secret scan passed."
  exit 0
fi

# Filter out known-safe public anon keys
cp "$TMP_FILE" "$FILTERED_FILE"
for safe_key in "${KNOWN_PUBLIC_ANON_KEYS[@]}"; do
  # Remove lines that contain a known public anon key
  grep -vF "$safe_key" "$FILTERED_FILE" > "${FILTERED_FILE}.tmp" || true
  mv "${FILTERED_FILE}.tmp" "$FILTERED_FILE"
done

if [[ -s "$FILTERED_FILE" ]]; then
  echo "Found potential secrets:"
  sort -u "$FILTERED_FILE"
  exit 1
fi

echo "Secret scan passed (public anon keys excluded)."
