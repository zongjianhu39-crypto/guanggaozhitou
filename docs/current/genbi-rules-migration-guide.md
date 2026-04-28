# GenBI 规则配置完全动态化迁移指南

## 📋 迁移概述

**一次性完成**将硬编码在 `genbi-semantic.json` 中的 9 个规则配置迁移到数据库，并增强动态引擎以支持所有复杂逻辑，实现**完全动态化**的规则管理。

## 🎯 迁移目标（一次性完成）

1. ✅ 所有规则配置存储在数据库中（单一数据源）
2. ✅ 可通过规则管理页面编辑**所有**规则（包括原有 9 个）
3. ✅ 动态引擎增强以支持复杂逻辑（FocusPool、多字段排序等）
4. ✅ 移除硬编码配置，消除双模式混乱
5. ✅ 为未来扩展提供清晰的配置流程

## 📦 迁移内容

### 迁移的 9 个规则

| 序号 | 规则 Key | 规则名称 | 关联意图 | 数据源 |
|------|---------|---------|---------|--------|
| 1 | `crowdBudget` | 人群预算建议 | `crowd_budget` | 人群数据 |
| 2 | `crowdMix` | 老客新客结构分析 | `crowd_mix` | 人群数据 |
| 3 | `dailyDropReason` | 昨日花费波动归因 | `daily_drop_reason` | 人群数据 |
| 4 | `weakProducts` | 高花费低回报商品 | `weak_products` | 单品广告 |
| 5 | `productPotential` | 冲销售额商品识别 | `product_potential` | 单品广告 |
| 6 | `productSales` | 单商品销售查询 | `product_sales` | 单品广告 |
| 7 | `periodicReport` | 周期报告 | `weekly_report` | 整体+人群+单品 |
| 8 | `lossReason` | 亏损原因分析 | `loss_reason` | 整体+人群+单品 |

> 注意：`weekly_report` 和 `monthly_report` 共用 `periodicReport` 规则

## 🚀 执行步骤（一次性完成）

### 步骤 1：执行数据库迁移脚本

```bash
# 进入 supabase 目录
cd /Users/zhouhao/Desktop/website/supabase

# 执行迁移脚本（通过 Supabase Dashboard 或 CLI）
# 方式 1：使用 Supabase CLI
supabase db push

# 方式 2：手动执行 SQL（推荐先测试）
# 复制 migrations/20260428_migrate_hardcoded_rules_to_database.sql 的内容
# 在 Supabase Dashboard -> SQL Editor 中执行
```

**验证迁移结果：**
```sql
-- 检查 9 个规则是否成功插入
SELECT 
  rule_key,
  label,
  config->>'intentKey' as intent_key,
  is_active,
  created_at
FROM genbi_rule_configs
WHERE updated_by = 'system_migration'
ORDER BY rule_key;

-- 应该返回 8 条记录（periodicReport 被 weekly_report 和 monthly_report 共用）
```

### 步骤 2：部署边缘函数（包含增强的动态引擎）

**重要：此版本动态引擎已增强，支持所有复杂逻辑！**

```bash
# 部署更新后的函数
cd /Users/zhouhao/Desktop/website/supabase

# 部署规则管理 API（支持编辑所有规则）
supabase functions deploy genbi-rule-admin

# 部署查询 API（包含增强的动态规则引擎）
supabase functions deploy genbi-query

# 部署语义配置（已移除硬编码）
supabase functions deploy genbi-rules
```

**动态引擎增强的能力：**
- ✅ FocusPool 筛选逻辑（用于 weakProducts）
- ✅ 多字段排序（用于 weakProducts、productPotential）
- ✅ ROI * GMV 复合排序（用于 productPotential）
- ✅ 最小花费占比过滤（用于 crowdBudget）
- ✅ 排除特定分层（用于 crowdBudget）
- ✅ 正花费/正订单数过滤（用于 productPotential）

### 步骤 3：验证功能

#### 3.1 验证规则管理页面

1. 访问 `https://www.friends.wang/genbi-rule-admin.html`
2. 检查规则列表是否显示 9 个规则
3. 确认每个规则显示"动态规则"标签（绿色）
4. 点击规则查看配置是否正确

#### 3.2 验证 GenBI 功能

测试以下意图识别（所有规则都使用动态引擎）：

```
测试 1：人群预算建议（验证过滤逻辑）
提问：“哪些人群该加预算”
预期：
- 过滤掉花费占比 < 5% 的人群
- 排除“未知”分层
- 按 order_cost 升序/降序排序
- 显示 top 3 加预算/减预算人群

测试以下意图识别：

```
测试 1：人群预算建议（验证过滤逻辑）
提问：“哪些人群该加预算”
预期：
- 过滤掉花费占比 < 5% 的人群
- 排除“未知”分层
- 按 order_cost 升序/降序排序
- 显示 top 3 加预算/减预算人群

测试 2：高花费低回报商品（验证 FocusPool 和多字段排序）
提问：“哪些商品花费高回报差”
预期：
- 先按花费降序取 top 20
- 覆盖 85% 总花费的商品进入 FocusPool
- 按 ROI 升序、花费降序、总花费降序 多字段排序
- 显示 top 8，highlight top 3

测试 3：冲销售额商品（验证 ROI * GMV 复合排序）
提问：“哪些商品该冲销售额”
预期：
- 过滤花费 > 0 且订单数 > 0 的商品
- 按 ROI * GMV 降序排序（潜力指标）
- 显示 top 6，highlight top 3

测试 4：周期报告（验证多数据源）
提问：“帮我整理上周周报”
预期：
- 同时查询整体、人群、单品数据
- 生成完整的周期报告

测试 2：商品效果诊断
提问："哪些商品花费高回报差"
预期：返回高花费低回报商品，使用数据库配置

测试 3：周期报告
提问："帮我整理上周周报"
预期：返回周期报告，使用数据库配置

测试 4：亏损分析
提问："为什么 ROI 低于 1"
预期：返回亏损原因分析，使用数据库配置
```

#### 3.3 验证 Fallback 机制

```sql
-- 临时禁用一个规则测试 Fallback
UPDATE genbi_rule_configs 
SET is_active = false 
WHERE rule_key = 'crowdBudget';

-- 测试提问
-- 预期：系统会自动回退到硬编码的专用 handler

-- 恢复规则
UPDATE genbi_rule_configs 
SET is_active = true 
WHERE rule_key = 'crowdBudget';
```

### 步骤 4：清理旧代码（可选，建议后续执行）

当确认数据库配置完全正常后，可以：

1. **移除 registry.ts 中的专用 Handler 注册**
   ```typescript
   // 从 INTENT_HANDLERS 中移除已迁移的规则
   // 保留 unsupported 的规则（如 budget_plan）
   ```

2. **删除 genbi-semantic.ts 中注释的规则配置**
   ```typescript
   // 移除注释掉的 rules 对象
   ```

3. **删除专用的 answerXxx 函数文件**（crowd.ts, product.ts, report.ts）
   > ⚠️ 注意：这需要确保动态引擎能完全替代这些函数的复杂逻辑

## 🔄 回滚方案

如果迁移后出现问题，可以快速回滚：

### 回滚步骤 1：恢复硬编码配置

```bash
# 恢复 genbi-semantic.ts 中的硬编码规则
git checkout HEAD -- website/supabase/functions/_shared/genbi-semantic.ts
```

### 回滚步骤 2：恢复 registry.ts

```bash
# 恢复原始的分发逻辑（优先使用专用 handler）
git checkout HEAD -- website/supabase/functions/genbi-rules/registry.ts
```

### 回滚步骤 3：停用数据库规则

```sql
-- 禁用所有迁移的规则
UPDATE genbi_rule_configs 
SET is_active = false 
WHERE updated_by = 'system_migration';
```

### 回滚步骤 4：重新部署

```bash
supabase functions deploy genbi-rule-admin
supabase functions deploy genbi-query
```

## 📊 迁移前后对比

### 迁移前

```
规则配置位置：genbi-semantic.json（硬编码）
修改方式：修改代码 + 部署
用户可见：否
意图映射：硬编码在 JSON 中
执行引擎：专用 Handler 函数
```

### 迁移后

```
规则配置位置：genbi_rule_configs 表（数据库）
修改方式：规则管理页面编辑
用户可见：是
意图映射：数据库 config.intentKey 字段
执行引擎：动态规则引擎（Fallback 到专用 Handler）
```

## ⚠️ 注意事项

### 1. 专用 Handler 的保留

**为什么保留？**
- 某些规则有复杂的业务逻辑（如 focusPool 计算）
- 动态引擎暂时无法完全替代
- 作为 Fallback 机制保证系统稳定性

**后续计划：**
- 逐步增强动态引擎能力
- 将简单规则完全迁移
- 最终移除专用 Handler（可选）

### 2. 配置格式

数据库中的规则配置格式：
```json
{
  "label": "规则名称",
  "version": "v1",
  "intentKey": "意图名称",  // ← 关键字段！
  "dataScope": ["crowd"],
  "strategy": { ... },
  "filters": { ... },
  "output": { ... }
}
```

### 3. 意图识别

- AI 通过 MiniMax 模型识别意图
- 识别结果需要匹配 `intentKey` 字段
- 如果匹配成功，使用动态规则引擎
- 如果匹配失败，回退到专用 Handler

### 4. 缓存机制

- 语义配置有 30 秒缓存
- 修改规则后会自动清除缓存
- 新配置在下次查询时生效

## 🎯 未来扩展

### 新增规则流程

1. **通过规则管理页面创建**
   - 点击"+ 新增"按钮
   - 填写规则名称和关联意图
   - 配置数据表、指标、输出参数
   - 保存规则

2. **系统自动处理**
   - 插入数据库 `genbi_rule_configs` 表
   - 清除语义配置缓存
   - 下次查询时自动生效

3. **用户使用**
   - 在 GenBI 中提问
   - AI 识别意图
   - 自动使用新规则
   - 返回分析结果

### 配置最佳实践

```
规则名称：[分析维度] + [分析目标]
关联意图：小写字母 + 下划线（如 new_product_analysis）
数据表：根据分析维度选择（人群/单品/整体）
指标：3-5 个核心指标
输出参数：根据分析深度调整
```

## 📞 问题排查

### 常见问题

**Q1：规则没有生效？**
```sql
-- 检查规则是否激活
SELECT rule_key, is_active FROM genbi_rule_configs WHERE rule_key = 'xxx';

-- 检查 intentKey 是否正确
SELECT config->>'intentKey' as intent_key FROM genbi_rule_configs WHERE rule_key = 'xxx';
```

**Q2：AI 没有识别意图？**
- 检查提问是否清晰表达分析目标
- 查看日志：`[genbi-intent] AI 识别到自定义意图: xxx`
- 尝试换一种提问方式

**Q3：返回数据不符合预期？**
- 检查规则配置的 dataScope 是否正确
- 检查指标配置是否完整
- 查看动态引擎日志：`[registry] using dynamic rule from database`

### 日志查看

关键日志关键字：
```
[genbi-semantic] dynamic intent mapping: xxx -> yyy
[registry] using dynamic rule from database for intent: xxx
[registry] using hardcoded handler for intent: xxx
[dynamic-rule] executing rule xxx
```

## ✅ 迁移检查清单

- [ ] 数据库迁移脚本执行成功
- [ ] 9 个规则全部插入数据库
- [ ] 每个规则配置了 intentKey
- [ ] 边缘函数部署成功
- [ ] 规则管理页面显示 9 个规则
- [ ] 每个规则显示"动态规则"标签
- [ ] GenBI 功能测试通过（至少 4 个意图）
- [ ] Fallback 机制测试通过
- [ ] 回滚方案验证通过
- [ ] 文档更新完成

## 📚 相关文件

- 迁移脚本：`supabase/migrations/20260428_migrate_hardcoded_rules_to_database.sql`
- 规则管理页面：`website/genbi-rule-admin.html`
- 规则管理 JS：`website/assets/js/genbi-rule-admin.js`
- 动态规则引擎：`supabase/functions/genbi-rules/dynamic.ts`
- 规则分发器：`supabase/functions/genbi-rules/registry.ts`
- 语义配置：`supabase/functions/_shared/genbi-semantic.ts`
- 规则存储：`supabase/functions/_shared/genbi-rule-store.ts`

---

**迁移完成日期：** 2026-04-28  
**负责人：** 系统迁移脚本  
**版本：** v1.0
