-- =====================================================
-- GenBI 规则配置迁移脚本（完全动态化）
-- 用途：将硬编码的 9 个规则完全迁移到数据库
-- 策略：一次性完成，动态引擎增强以支持复杂逻辑
-- 日期：2026-04-28
-- 版本：v2（增强版）
-- =====================================================

-- 注意：此脚本会覆盖现有配置，请确认备份！

-- 插入/更新 9 个现有规则配置到数据库
-- 使用 ON CONFLICT DO UPDATE 确保完全覆盖现有配置

INSERT INTO public.genbi_rule_configs (rule_key, label, config, is_active, updated_by, updated_by_name)
VALUES
  -- 1. 人群预算建议
  (
    'crowdBudget',
    '人群预算建议',
    '{
      "label": "人群预算建议",
      "version": "v1",
      "intentKey": "crowd_budget",
      "dataScope": ["crowd"],
      "strategy": {
        "primaryMetric": "order_cost",
        "secondaryMetric": "crowd_cost_share",
        "increaseSort": "primary_asc",
        "decreaseSort": "primary_desc"
      },
      "filters": {
        "minCostShare": 0.05,
        "excludeLayers": ["未知"],
        "requireFinitePrimaryMetric": true
      },
      "output": {
        "topIncreaseCount": 3,
        "topDecreaseCount": 3,
        "tableLimit": 10
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 2. 老客新客结构分析
  (
    'crowdMix',
    '老客新客结构分析',
    '{
      "label": "老客新客结构分析",
      "version": "v1",
      "intentKey": "crowd_mix",
      "dataScope": ["crowd"],
      "strategy": {
        "primaryMetric": "crowd_cost_share",
        "comparisonLayers": ["老客", "新客", "兴趣新客"]
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 3. 昨日花费波动归因
  (
    'dailyDropReason',
    '昨日花费波动归因',
    '{
      "label": "昨日花费波动归因",
      "version": "v1",
      "intentKey": "daily_drop_reason",
      "dataScope": ["crowd"],
      "strategy": {
        "primaryMetric": "ad_cost",
        "comparisonMode": "current_vs_previous"
      },
      "output": {
        "topDropCount": 3
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 4. 高花费低回报商品
  (
    'weakProducts',
    '高花费低回报商品',
    '{
      "label": "高花费低回报商品",
      "version": "v1",
      "intentKey": "weak_products",
      "dataScope": ["single"],
      "strategy": {
        "primaryMetric": "product_direct_roi",
        "secondaryMetric": "order_cost",
        "sort": ["primary_asc", "secondary_desc", "cost_desc"]
      },
      "filters": {
        "minFocusPoolSize": 20,
        "focusPoolCostCoverage": 0.85,
        "requirePositiveCost": true
      },
      "output": {
        "topCount": 8,
        "highlightCount": 3
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 5. 冲销售额商品识别
  (
    'productPotential',
    '冲销售额商品识别',
    '{
      "label": "冲销售额商品识别",
      "version": "v1",
      "intentKey": "product_potential",
      "dataScope": ["single"],
      "strategy": {
        "primaryMetric": "product_direct_roi",
        "secondaryMetric": "product_direct_gmv",
        "sort": ["roi_x_gmv_desc"]
      },
      "filters": {
        "requirePositiveCost": true,
        "requirePositiveOrders": true
      },
      "output": {
        "topCount": 6,
        "highlightCount": 3
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 6. 单商品销售查询
  (
    'productSales',
    '单商品销售查询',
    '{
      "label": "单商品销售查询",
      "version": "v1",
      "intentKey": "product_sales",
      "dataScope": ["single"],
      "strategy": {
        "matchMode": "product_name_contains"
      },
      "output": {
        "resultLimit": 1
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 7. 周期报告（周报/月报共用）
  (
    'periodicReport',
    '周期报告',
    '{
      "label": "周期报告",
      "version": "v1",
      "intentKey": "weekly_report",
      "dataScope": ["ads", "crowd", "single"],
      "strategy": {
        "primaryMetric": "breakeven_roi",
        "secondaryMetric": "wow"
      },
      "output": {
        "topCrowdCount": 5,
        "topProductCount": 5
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  ),
  
  -- 8. 亏损原因分析
  (
    'lossReason',
    '亏损原因分析',
    '{
      "label": "亏损原因分析",
      "version": "v1",
      "intentKey": "loss_reason",
      "dataScope": ["ads", "crowd", "single"],
      "strategy": {
        "primaryMetric": "breakeven_roi",
        "crowdSort": "order_cost_desc",
        "productSort": "order_cost_desc"
      },
      "output": {
        "topCrowdCount": 3,
        "topProductCount": 3
      }
    }'::jsonb,
    true,
    'system_migration',
    '系统迁移脚本'
  )

ON CONFLICT (rule_key) 
DO UPDATE SET
  label = EXCLUDED.label,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active,
  updated_by = EXCLUDED.updated_by,
  updated_by_name = EXCLUDED.updated_by_name,
  updated_at = NOW();

-- 验证插入结果
SELECT 
  rule_key,
  label,
  config->>'intentKey' as intent_key,
  config->'dataScope' as data_scope,
  is_active,
  created_at
FROM public.genbi_rule_configs
WHERE updated_by = 'system_migration'
ORDER BY rule_key;

-- 注释说明
COMMENT ON TABLE public.genbi_rule_configs IS 'GenBI 意图规则配置，保存每个规则使用的数据表、指标、阈值和输出设置。包含从硬编码迁移的 9 个基础规则。';
