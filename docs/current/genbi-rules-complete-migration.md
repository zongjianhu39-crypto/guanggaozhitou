# GenBI 规则配置完全动态化 - 快速开始指南

## 🎯 概述

**一次性完成**将 9 个硬编码规则迁移到数据库，动态引擎已增强支持所有复杂逻辑。

## 📦 迁移内容

### 9 个规则及其增强能力

| 规则 | intentKey | 增强的动态引擎能力 |
|------|-----------|-------------------|
| 人群预算建议 | `crowd_budget` | ✅ 最小花费占比过滤、排除分层 |
| 老客新客结构 | `crowd_mix` | ✅ 标准过滤和排序 |
| 昨日花费波动 | `daily_drop_reason` | ✅ 标准过滤和排序 |
| 高花费低回报商品 | `weak_products` | ✅ FocusPool 筛选、多字段排序 |
| 冲销售额商品 | `product_potential` | ✅ ROI*GMV 复合排序、正花费/订单过滤 |
| 单商品查询 | `product_sales` | ✅ 商品名称匹配 |
| 周期报告 | `weekly_report` | ✅ 多数据源查询 |
| 亏损原因分析 | `loss_reason` | ✅ 多数据源查询 |

## 🚀 3 步完成迁移

### 步骤 1：执行数据库迁移

```bash
# 方式 1：Supabase CLI（推荐）
cd /Users/zhouhao/Desktop/website/supabase
supabase db push

# 方式 2：手动执行
# 复制 migrations/20260428_migrate_hardcoded_rules_to_database.sql
# 在 Supabase Dashboard -> SQL Editor 中执行
```

### 步骤 2：部署边缘函数

```bash
cd /Users/zhouhao/Desktop/website/supabase

supabase functions deploy genbi-rule-admin
supabase functions deploy genbi-query
supabase functions deploy genbi-rules
```

### 步骤 3：验证

```
1. 访问规则管理页面
   → 应该看到 9 个规则，都显示"动态规则"标签（绿色）

2. 测试 GenBI 功能
   → 提问："哪些人群该加预算"
   → 预期：返回人群预算建议，使用数据库配置

3. 检查日志
   → 看到：[registry] using dynamic rule from database
```

## ⚡ 动态引擎增强能力详解

### 1. FocusPool 筛选（用于 weakProducts）

```typescript
// 配置
{
  "filters": {
    "minFocusPoolSize": 20,        // 最小商品数
    "focusPoolCostCoverage": 0.85  // 花费覆盖比例
  }
}

// 逻辑：按花费降序，取 top 20 或覆盖 85% 总花费的商品
```

### 2. 多字段排序（用于 weakProducts）

```typescript
// 配置
{
  "strategy": {
    "sort": ["primary_asc", "secondary_desc", "cost_desc"]
  }
}

// 逻辑：先按 ROI 升序，相同则按订单成本降序，再相同则按总花费降序
```

### 3. ROI * GMV 复合排序（用于 productPotential）

```typescript
// 配置
{
  "strategy": {
    "sort": ["roi_x_gmv_desc"]
  }
}

// 逻辑：按 ROI × GMV 降序，识别高潜力商品
```

### 4. 最小花费占比过滤（用于 crowdBudget）

```typescript
// 配置
{
  "filters": {
    "minCostShare": 0.05  // 过滤花费占比 < 5% 的人群
  }
}
```

### 5. 排除特定分层（用于 crowdBudget）

```typescript
// 配置
{
  "filters": {
    "excludeLayers": ["未知"]  // 排除"未知"分层
  }
}
```

## 📊 迁移前后对比

### 迁移前
- ❌ 规则配置在代码文件中（硬编码）
- ❌ 修改需要改代码 + 部署
- ❌ 用户不可见
- ❌ 双模式并存，混乱

### 迁移后
- ✅ 规则配置在数据库中（单一数据源）
- ✅ 通过页面编辑，即时生效
- ✅ 用户完全可见和可控
- ✅ 完全动态化，清晰一致

## ⚠️ 重要说明

### 专用 Handler 的状态

**保留但废弃：**
- 专用 Handler 代码保留在 registry.ts 中
- 但**永远不会被调用**（数据库优先）
- 标记为 `@deprecated`
- 未来版本会删除

### 回滚方案

如果出现问题：

```bash
# 1. 恢复代码
git checkout HEAD -- website/supabase/functions/_shared/genbi-semantic.ts
git checkout HEAD -- website/supabase/functions/genbi-rules/registry.ts

# 2. 禁用数据库规则
# 在 SQL Editor 执行：
UPDATE genbi_rule_configs 
SET is_active = false 
WHERE updated_by = 'system_migration';

# 3. 重新部署
supabase functions deploy genbi-rule-admin
supabase functions deploy genbi-query
```

## ✅ 验证清单

- [ ] 数据库迁移脚本执行成功
- [ ] 9 个规则全部在数据库中
- [ ] 边缘函数部署成功
- [ ] 规则管理页面显示 9 个"动态规则"
- [ ] GenBI 功能测试通过（至少 4 个意图）
- [ ] 日志显示使用动态规则引擎

## 🎉 完成！

迁移完成后：
- 所有规则通过数据库管理
- 新增规则只需配置，无需开发
- 系统完全动态化
- 代码更清晰，维护更简单

---

**迁移日期：** 2026-04-28  
**版本：** v2（完全动态化）  
**状态：** 一次性完成
