# 📜 网站驾驶舱变更日志

按时间倒序排列，记录所有影响线上功能的重大变更、修复与决策。

---

## 2026-04-19 — Dashboard 数据链路修复与自动化增强

### 🔧 核心修复
- **单品广告无数据问题**：手动刷新 `dashboard_single_product_daily_summary` 聚合表，从 0 行恢复至 3849 行（覆盖 `2026-01-01` 至 `2026-04-17`）
- **CSV 表头空格导致上传失败**：在 `pipeline/cleaner.py` 中增强 `clean_column_name()`，自动移除 BOM、NBSP 和首尾空白，确保 `single_product_ad_2026` 等表上传成功（4204 行）
- **上传后自动刷新聚合表**：新增 `dashboard_refresh` 配置模块，支持按原始表类型自动触发对应聚合刷新（`ads`/`crowd`/`single`），避免页面显示旧数据
- **全量上传超时问题**：将 `ads` 和 `crowd` 聚合刷新由「全量扫描」改为「分段执行」（`ads` 按月、`crowd` 按 7 天），彻底解决数据库 `statement timeout` 错误

### 🛠️ 技术实现
- 新增文件：`pipeline/dashboard_refresh.py`, `pipeline/reporter.py`
- 新增配置：`config.yaml` 中 `dashboard_refresh` 区块
- 刷新策略映射：
  | 上传原始表 | 自动刷新模块 |
  |---|---|
  | `single_product_ad_2025/2026` | `single` |
  | `financial_2025/2026`, `taobao_live_2025/2026`, `super_live_YYYYMM` | `ads` |
  | `super_live_2025`, `super_live_YYYYMM` | `crowd` |

### ✅ 验收结果
- 所有原始表上传成功，聚合表全部补刷完成
- `npm run check:release` 门禁通过
- 线上 `supabase-dashboard.html` 页面数据实时、准确

### 📌 后续建议
- 将刷新拆分粒度配置化（如 `crowd` 支持 3 天一段）
- 在桌面命令脚本中增加更清晰的成功/失败提示

---

## 2026-04-19 — 网站驾驶舱风险梳理（工单）

### ⚠️ 关键风险模块
| 模块 | 页面 / 文件 | 风险等级 | 备注 |
|---|---|---|---|
| 计划看板 | `plan-dashboard.html`、`supabase/functions/plan-dashboard-summary/` | 高 | 字段映射、保存链路、月说明表 |
| 数据看板 | `supabase-dashboard.html`、`supabase/functions/dashboard-data/` | 高 | 依赖聚合表和上传刷新链路 |
| Edge Function | `supabase/functions/` | 高 | CORS、鉴权、接口返回 |
| 数据库迁移 | `supabase/migrations/` | 高 | 表结构和 RLS |

### 📐 文档滞后处理规则（优先级从高到低）
1. Supabase 实际表结构
2. migration 脚本
3. 当前线上可运行函数 / SQL
4. 当前测试结果
5. 当前说明文档
6. 历史日志和旧记录

### ✅ 上线前检查项
- [x] `npm run check:release` 已通过
- [x] 浏览器 Network / CORS 验收完成
- [x] 数据库 migration 验收完成（按需）
- [ ] 保留旧版压缩包（上线前补路径）
- [ ] 保留旧版 Edge Function 代码（上线前补 commit 或备份路径）

> 本工单作为 2026-04-19 的风险控制和问题记录入口，后续字段级修复均以 Supabase 实际表结构为唯一权威源。