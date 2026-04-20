# 计划拆解模块说明

注意：本文档是模块说明，不是数据库事实源。涉及表名、字段名和线上数据结构时，以 Supabase 实际表结构、migration 和当前 Edge Function 代码为准。

## 第一版范围

- 独立页面：`plan-dashboard.html`
- 数据查询：Edge Function `plan-dashboard-summary`
- 页面能力：
  - 日期范围查询
  - KPI 展示
  - 活动时间轴
  - 每日明细表
  - 行内编辑计划金额 / 活动覆盖 / 备注
  - 保存单日
  - 保存全部
  - 活动新增 / 编辑 / 删除

## 数据来源

- 计划表：`public.ad_plans`
- 活动表：`public.ad_plan_activities`
- 万相台实际花费：`public.short_live_link_2026`（当前取 `date` + `花费`）
- 有客代投实际花费：`public.live_ad_agent_2026`（当前取 `date` + `amount`）
- 佣金收入：`public.financial_2026`
- 25 年参考：`public.super_live_2025` 同月同日花费汇总

## 当前已知待确认口径

1. `overall_completion_rate` 可能大于 1，需要业务确认实际花费与计划金额口径是否完全一致。
2. `wanxiang_actual_cost` 当前取 `short_live_link_2026`，后续如需切换为更准确来源表，可只改函数内部聚合逻辑。
3. `reference_2025_amount` 当前只做展示，不参与完成率计算。
