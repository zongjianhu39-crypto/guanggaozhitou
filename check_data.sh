#!/bin/bash
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqc2NzaWtpdGhieHV4bWp5anNwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkyNzk4NiwiZXhwIjoyMDg5NTAzOTg2fQ.WevVd8IJ_qWIbXNP2CRNyA6paPtL8yA8vacn5JSzJW4"
URL="https://qjscsikithbxuxmjyjsp.supabase.co/rest/v1"

echo "=== dashboard_crowd_daily_summary (04-21 to 04-27) ==="
curl -s "${URL}/dashboard_crowd_daily_summary?select=日期,人群名字,花费&日期=gte.2026-04-21&日期=lte.2026-04-27&limit=5" \
  -H "apikey: ${API_KEY}" \
  -H "Authorization: Bearer ${API_KEY}"

echo ""
echo "=== super_live_202604 (04-21 to 04-27, crowd) ==="
curl -s "${URL}/super_live_202604?select=日期,人群名字,花费&日期=gte.2026-04-21&日期=lte.2026-04-27&limit=5" \
  -H "apikey: ${API_KEY}" \
  -H "Authorization: Bearer ${API_KEY}"

echo ""
echo "=== super_live_202604 total count ==="
curl -s "${URL}/super_live_202604?select=日期&日期=gte.2026-04-21&日期=lte.2026-04-27" \
  -H "apikey: ${API_KEY}" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Prefer: count=exact" | head -c 200

echo ""
echo "=== genbi_rule_configs (crowdBudget) ==="
curl -s "${URL}/genbi_rule_configs?select=rule_key,config&rule_key=eq.crowdBudget" \
  -H "apikey: ${API_KEY}" \
  -H "Authorization: Bearer ${API_KEY}"
