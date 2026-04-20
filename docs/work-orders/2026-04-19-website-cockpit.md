# 2026-04-19 网站驾驶舱工单

## 工单定位

本工单用于记录 2026-04-19 对网站模块、风险、发布检查和回滚方式的梳理。桌面上的 `网站驾驶舱—419.docx` 可作为展示版，但仓库内此 Markdown 文件作为后续可追踪记录入口。

## 涉及模块

| 模块 | 页面 / 文件 | 风险等级 | 备注 |
|---|---|---|---|
| 计划看板 | `plan-dashboard.html`、`supabase/functions/plan-dashboard-summary/` | 高 | 涉及字段映射、保存链路、月说明表 |
| 数据看板 | `supabase-dashboard.html`、`supabase/functions/dashboard-data/` | 高 | 依赖聚合表和上传刷新链路 |
| Edge Function | `supabase/functions/` | 高 | 涉及 CORS、鉴权、接口返回 |
| 数据库迁移 | `supabase/migrations/` | 高 | 涉及表结构和 RLS |
| 发布检查 | `npm run check:release` | 中高 | 发布门禁必须稳定通过 |

## 已识别问题

| 类别 | 问题 | 当前处理原则 |
|---|---|---|
| 计划看板字段 | 字段说明和真实 Supabase 表结构可能不一致 | 字段以 Supabase 实际表结构为准，不以历史文档为准 |
| 月说明表 | `ad_plan_month_notes` 相关依赖需要 migration 支撑 | 上线前必须确认 migration 是否需要执行 |
| `actual_cost` 口径 | 口径需要业务确认后再改 | 未确认前不要仅凭文档调整 |
| CORS | 不同 Edge Function 可能存在策略不一致 | 可以统一 helper，但需逐个页面验收 |
| 发布检查 | `check:release` 应作为本地门禁 | 通过不等于线上已验收 |

## 文档滞后处理规则

涉及数据库字段、表名、口径时，按以下优先级判断：

1. Supabase 实际表结构
2. migration
3. 当前线上可运行函数 / SQL
4. 当前测试
5. 当前说明文档
6. 历史日志和驾驶舱旧记录

## 上线前检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 保留旧版压缩包 | 未确认 | 上线前补路径 |
| 保留旧版 Edge Function 代码 | 未确认 | 上线前补 commit 或备份路径 |
| 执行 release check | 待执行 | `npm run check:release` |
| 浏览器 Network / CORS 验收 | 待执行 | 以线上页面为准 |
| 数据库 migration 验收 | 按需执行 | 只在确认需要时执行 |

## 结论

本工单保留为 2026-04-19 的风险控制和问题记录。后续任何字段级修复都应先核对 Supabase 实际表结构，再修改代码、测试和说明文档。
