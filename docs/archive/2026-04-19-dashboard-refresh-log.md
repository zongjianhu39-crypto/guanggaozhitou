# 开发日志 - 2026-04-19

## 主题

修复 Supabase Dashboard 数据看板在原始表更新后聚合表不自动更新的问题，并增强桌面 CSV 上传脚本，使其在上传完成后自动刷新 Dashboard 聚合表。

## 背景问题

Dashboard 页面 `supabase-dashboard.html` 中的三个数据模块：

- 投放分析
- 人群维度
- 单品广告

页面实际通过 `dashboard-data` 接口读取 Dashboard 聚合表：

- `dashboard_ads_daily_summary`
- `dashboard_crowd_daily_summary`
- `dashboard_single_product_daily_summary`

数据库中还有一组 `dashboard_src_*` 对象：

- `dashboard_src_financial`
- `dashboard_src_single_product_ad`
- `dashboard_src_super_live`
- `dashboard_src_taobao_live`

确认后发现：

- `dashboard_src_*` 是 view，只负责实时读取/合并原始表，不存储数据。
- `dashboard_*_daily_summary` 是实际聚合表，会存储聚合后的数据。
- 原始表更新后，view 会实时反映变化，但聚合表不会自动更新。
- Dashboard 页面优先读取聚合表，因此如果聚合表没有刷新，页面会显示旧数据或无数据。

## 原始表与聚合表关系

### `dashboard_ads_daily_summary`

来源：

- `super_live_2025`
- `super_live_202601`
- `super_live_202602`
- `super_live_202603`
- `super_live_202604`
- `super_live_202605`
- `super_live_202606`
- `financial_2025`
- `financial_2026`
- `taobao_live_2025`
- `taobao_live_2026`

用途：投放分析聚合，按日期汇总超级直播、财务、淘宝直播相关指标。

### `dashboard_crowd_daily_summary`

来源：

- `super_live_2025`
- `super_live_202601`
- `super_live_202602`
- `super_live_202603`
- `super_live_202604`
- `super_live_202605`
- `super_live_202606`

用途：人群维度聚合，按日期和人群名字汇总。

### `dashboard_single_product_daily_summary`

来源：

- `single_product_ad_2025`
- `single_product_ad_2026`

用途：单品广告聚合，按日期和商品汇总。

## 已完成修复一：单品广告无数据问题

排查发现：

- 原始表 `single_product_ad_2026` 在 `2026-01-01` 到 `2026-04-16` 有 4177 行。
- 但聚合表 `dashboard_single_product_daily_summary` 当时是 0 行。
- 刷新日志显示 `single` 模块曾经刷新成功但 `row_count=0`。

处理：

- 手动调用 `refresh_dashboard_summary` 刷新单品聚合。
- 刷新后 `dashboard_single_product_daily_summary` 在 `2026-01-01` 到 `2026-04-16` 有 3823 行。
- 后续上传修复完成后，又刷新到 `2026-01-01` 到 `2026-04-17`，聚合行数为 3849。

## 已完成修复二：CSV 表头尾空格导致上传失败

用户运行：

```bash
cd ~/.openclaw/workspace/skills/supabase-csv-pipeline
python3 main.py --config config.yaml --execute --table single_product_ad_2026
```

报错：

```text
Could not find the '观看人数 ' column of 'single_product_ad_2026' in the schema cache
```

原因：

CSV 表头存在尾空格，例如：

- `该商品收藏成本 `
- `该商品直接预售成交金额 `
- `该商品直接预售成交roi `
- `观看人数 `

数据库真实列名没有尾空格。

处理：

- 修改 `pipeline/cleaner.py`
- 在 `clean_column_name()` 中增加列名清洗：
  - 去掉 BOM
  - 去掉 NBSP
  - 去掉首尾空白

验证：

- 重新上传 `single_product_ad_2026` 成功。
- 上传行数：4204
- Supabase 校验行数：4204
- 日期范围：`2026-01-01` 到 `2026-04-17`

## 已完成修复三：上传后自动刷新 Dashboard 聚合表

确认方案：

```text
桌面 Python 上传脚本
-> 上传 CSV 到原始表
-> 上传成功后调用 Supabase 数据库 RPC
-> RPC 刷新 Dashboard 聚合表
-> 页面查询时读取最新聚合结果
```

明确没有采用的方案：

- 不新增刷新 Edge Function
- 不改 `dashboard-data` 查询逻辑
- 不改前端页面
- 不加 trigger / cron / pg_cron
- 不改聚合表结构

实现文件：

- `pipeline/dashboard_refresh.py`
- `main.py`
- `pipeline/reporter.py`
- `config.yaml`
- `examples/config.example.yaml`

新增配置：

```yaml
dashboard_refresh:
  enabled: true
  rpc: refresh_dashboard_summary
  fail_on_error: true
  max_attempts: 2
```

刷新模块映射：

| 上传原始表 | 自动刷新模块 |
|---|---|
| `single_product_ad_2025/2026` | `single` |
| `financial_2025/2026` | `ads` |
| `taobao_live_2025/2026` | `ads` |
| `super_live_2025`、`super_live_YYYYMM` | `ads` + `crowd` |
| 其他表 | 不刷新 |

刷新时机：

- 不是每上传一个文件就刷新。
- 而是一次脚本运行内，所有表处理完后，统一汇总刷新。

日志新增内容：

- 成功上传了哪些相关原始表
- 判定要刷新哪些模块
- 本批影响日期范围
- 每次 RPC 调用状态
- 最终状态

状态区分：

- 上传失败
- 上传成功，聚合刷新成功
- 上传成功，但聚合刷新失败

## 已完成修复四：全量上传刷新超时问题

用户运行全量上传：

```bash
cd ~/.openclaw/workspace/skills/supabase-csv-pipeline
python3 main.py --config config.yaml --execute
```

上传结果：

- 扫描文件数：14
- 匹配任务数：14
- 成功表数：11
- 失败表数：0

第一次聚合刷新结果：

- `single` 成功
- `ads` 失败：`canceling statement due to statement timeout`
- `crowd` 失败：`canceling statement due to statement timeout`

原因：

脚本最初把整批影响范围合并为：

```text
2025-01-01 至 2026-04-17
```

然后一次性刷新 `ads` 和 `crowd`，扫描范围过大导致数据库 statement timeout。

优化：

- `ads` 按月拆分刷新。
- `single` 按月拆分刷新。
- `crowd` 数据量更大，按 7 天拆分刷新。
- 同一模块内先合并重叠日期范围，再拆分，避免重复 RPC。

补刷结果：

- `ads` 从 2025-01 到 2026-04 分月补刷全部成功。
- `crowd` 原先失败的 2026-01 和 2026-03，按 7 天拆分补刷全部成功。
- 数据库 `dashboard_summary_refresh_log` 中最近的 `crowd` 分段均为 `success`。

## 当前最终状态

目前已经完成：

- 原始表上传脚本可正常上传单表和全量批次。
- 上传成功后会自动刷新 Dashboard 聚合表。
- 单品聚合刷新已验证成功。
- 全量上传后 `ads`、`crowd`、`single` 聚合均已补刷成功。
- 后续再执行上传脚本时，会自动分段刷新，降低数据库超时风险。

## 常用命令

### 单表上传

```bash
cd ~/.openclaw/workspace/skills/supabase-csv-pipeline
python3 main.py --config config.yaml --execute --table single_product_ad_2026
```

### 全量上传

```bash
cd ~/.openclaw/workspace/skills/supabase-csv-pipeline
python3 main.py --config config.yaml --execute
```

### Dry-run 验证，不实际上传或刷新

```bash
cd ~/.openclaw/workspace/skills/supabase-csv-pipeline
python3 main.py --config config.yaml --dry-run
```

## 验收结果

已验证：

- `single_product_ad_2026` 上传后自动刷新 `single`。
- `super_live_202604` dry-run 判定会刷新 `ads` 和 `crowd`。
- 全量 dry-run 能识别 `ads`、`crowd`、`single`。
- 全量正式上传后，原始表上传成功。
- 因超时失败的 `ads` 和 `crowd` 已通过分段策略补刷成功。

## 后续建议

- 后续上传使用现有命令即可，不需要手动执行 SQL 刷新。
- 如果未来数据量继续增长，可以考虑把刷新拆分粒度配置化，例如 `crowd` 3 天一段、`ads` 15 天一段。
- 如需进一步自动化，可在桌面命令脚本中增加更清晰的成功/失败提示，但当前核心链路已经打通。
