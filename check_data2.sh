#!/bin/bash
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqc2NzaWtpdGhieHV4bWp5anNwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkyNzk4NiwiZXhwIjoyMDg5NTAzOTg2fQ.WevVd8IJ_qWIbXNP2CRNyA6paPtL8yA8vacn5JSzJW4"
URL="https://qjscsikithbxuxmjyjsp.supabase.co/rest/v1"

echo "=== 1. 列出 super_live 相关表 ==="
curl -s "${URL}/" -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" 2>&1 | head -c 300
echo ""

echo "=== 2. super_live_202604 表名尝试==="
for tbl in super_live_202604 super_live_2026_04 "super_live_2026-04"; do
  echo "--- Table: $tbl ---"
  curl -s "${URL}/${tbl}?select=日期&日期=gte.2026-04-21&日期=lte.2026-04-27&limit=2" \
    -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" | head -c 200
  echo ""
done

echo "=== 3. dashboard_crowd_daily_summary 全部最新 ==="
curl -s "${URL}/dashboard_crowd_daily_summary?select=日期,人群名字&order=日期.desc&limit=3" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" | head -c 300
echo ""

echo "=== 4. dashboard_ads_daily_summary 最新 ==="
curl -s "${URL}/dashboard_ads_daily_summary?select=日期&order=日期.desc&limit=3" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" | head -c 200
echo ""

echo "=== 5. super_live 各表的最新数据日期 ==="
for tbl in super_live_202604 super_live_202603 super_live_202602 super_live_202601 super_live_2025; do
  result=$(curl -s "${URL}/${tbl}?select=日期&order=日期.desc&limit=1" \
    -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" 2>&1)
  if echo "$result" | grep -q '"日期"'; then
    echo "$tbl: $result"
  else
    echo "$tbl: (empty or not found)"
  fi
done

echo ""
echo "=== 6. 检查人群名字列是否存在 ==="
curl -s "${URL}/super_live_202604?select=人群名字&limit=1" \
  -H "apikey: ${API_KEY}" -H "Authorization: Bearer ${API_KEY}" | head -c 200
echo ""
