# 龙虾小风网站 - 部署文档

## 变更记录

### 2026-04-09 — GitHub Copilot

- 后端（Edge Function）：修复 `toNum()`，在解析前移除千分位逗号（`.replace(/,/g,'')`），避免 `parseFloat` 被截断；已重新部署 `dashboard-data`。
- 数据修复：
  - `financial`：修复含逗号的数值字段 28 行。
  - `taobao_live`：修复含逗号的数值字段 31 行。
  - `single_product_ad`：清空重复数据并重新上传正确文件（3879 行）。
- 前端：更新 `website/supabase-dashboard.html` 与 `website/dashboard.js`，新增/修正“📦 单品广告”面板；`loadSingle()` 改用 anon headers，KPI-grid 布局修复，新增 `downloadSingleCSV()`；已通过 FTP 部署。
- 验证：对 `2026-03-01` 至 `2026-03-28` 的跨表计算做程序化验证，关键 KPI 值已校正（保量佣金、退货率、ROI 等）。
- 建议：在数据摄取链路加入千分位归一化（导入时 strip commas）；如需回滚，先恢复数据库备份（若有），并重新部署先前版本的 Edge Function。

## 网站信息
- 地址：https://www.friends.wang
- 托管：西部数码虚拟主机
- FTP：<REDACTED - 请在 CI/Secrets 中配置，不要在仓库中保存明文凭据>
- 账号：<REDACTED - 使用 CI Secrets>
- 密码：<REDACTED - 使用 CI Secrets>
- 根目录：/wwwroot

> 安全提醒：仓库中不应包含任何明文凭据。已将原始凭据从此文件中移除。请把 FTP/部署相关凭据添加到 CI 或安全的 secrets 管理中（如 GitHub Actions Secrets）。

## 上传命令
```bash
# 上传任意文件到网站
curl -T 本地文件 "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/目标文件"
```

## 文件说明

### 前端页面
| 文件 | 说明 | 访问地址 |
|------|------|----------|
| index.html | 首页 | https://www.friends.wang/ |
| supabase-dashboard.html | 投放数据看板（从 Supabase 读数据） | https://www.friends.wang/supabase-dashboard.html |
| insights.html | 洞察中心 / AI 报告汇总页 | https://www.friends.wang/insights.html |
| prompt-admin.html | Prompt 管理台（草稿 / 预览 / 发布 / 回滚） | https://www.friends.wang/prompt-admin.html |
| internal.html | 兼容旧链接的跳转页（重定向到首页） | https://www.friends.wang/internal.html |
| 404.html | 404 错误页 | https://www.friends.wang/404.html |

### 前端资源
| 文件 | 说明 |
|------|------|
| style.css | 全局样式 |
| script.js | 全局脚本 |
| dashboard.js | 数据看板独立脚本 |
| prompt-admin.js | Prompt 管理台脚本 |
| auth.js | 登录验证脚本 |
| favicon.svg | 网站图标 |
| robots.txt | 搜索引擎爬虫配置 |

### 认证模块
| 路径 | 说明 |
|------|------|
| auth/index.html | 飞书登录页 |
| auth/feishu/callback.html | 飞书 OAuth 回调页 |
| assets/ | 前端静态资源目录（含 config、图片、dashboard-spec.json 等） |

### 数据库 SQL（后端，非站点资源）
| 路径 | 说明 |
|------|------|
| supabase/migrations/ | 数据库迁移脚本目录 |
| supabase/functions/ | Edge Functions 源码目录 |

**注意**：迁移脚本和 Edge Functions 源码只用于 Supabase 本地开发，不要通过 FTP 上传到虚拟主机站点目录。

### 数据上传脚本
| 文件 | 说明 |
|------|------|
| scripts/deploy_lftp.sh | **推荐** — lftp 多文件上传脚本（解决 curl 425 错误） |
| scripts/deploy_final.py | 静态文件部署脚本 |
| scripts/deploy_ftp.py | FTP 上传脚本（curl 版） |
| scripts/deploy_report_center.py | AI 报告中心一键部署脚本 |
| scripts/verify_report_center.py | 报告中心核验脚本 |
| scripts/verify_dashboard_flow.py | 数据看板回归核验脚本（增强版） |

> **推荐使用 `deploy_lftp.sh`**，lftp 专门解决 curl 多文件上传时的 425 数据连接错误和卡死问题，每个文件最多重试 3 次，失败自动清理锁文件，上传后自动验证 HTTP 200。

### 数据库 SQL
| 文件 | 说明 |
|------|------|
| supabase/migrations/ | 数据库迁移脚本 |

## Supabase 数据库
- 项目：https://qjscsikithbxuxmjyjsp.supabase.co
- Anon Key：见 `assets/js/config.js` 或部署环境变量，不在文档中重复保存
- Service Role Key：（仅后端 Edge Functions 使用，严禁泄露）
- 数据表：
  - super_live_202601 ~ super_live_202612（按月分表）
  - taobao_live（合并）
  - financial（合并）
  - ai_report_runs（AI 分析运行记录）
  - ai_reports（已发布洞察报告）
  - ai_playbooks（策略/玩法沉淀）
  - ai_prompt_templates（Prompt 模板主表）
  - ai_prompt_versions（Prompt 版本表）

## 数据更新流程
```
1. 下载最新 CSV → 放到 /Users/zhouhao/Desktop/投放数据/26年/
2. csv-number-converter 清洗格式
3. supabase-upload 上传到 Supabase
4. 看板页面自动读取最新数据
```

## AI 报告中心部署补充

### 1. 执行数据库迁移
```bash
cd /Users/zhouhao/Desktop/website
supabase db push
```

如果只想执行 AI 报告中心相关迁移，重点文件是：
- supabase/migrations/20260403_create_ai_reports.sql
- supabase/migrations/20260404_create_ai_prompt_management.sql

### 2. 部署 Supabase Edge Functions
```bash
cd /Users/zhouhao/Desktop/website
supabase functions deploy ai-analysis
supabase functions deploy ai-reports
supabase functions deploy ai-prompt-admin
supabase functions deploy dashboard-data
supabase functions deploy feishu-auth
```

部署 `feishu-auth` 前，先把飞书配置写入 Supabase Secrets：
```bash
cd /Users/zhouhao/Desktop/website
supabase secrets set FEISHU_APP_ID="你的飞书 App ID" FEISHU_APP_SECRET="你的飞书 App Secret"
```

如果 App Secret 曾经出现在源码里，应视为已暴露，先去飞书开放平台重置旧 Secret，再把新值写入 Supabase Secrets。

### 3. 上传前端文件到虚拟主机

**重要**：西部数码虚拟主机只上传静态资源（.html .css .js .svg），不要把 supabase/functions、supabase/migrations 这些后端源码上传到站点目录。

#### 方式一：lftp 一键上传（推荐）
```bash
cd /Users/zhouhao/Desktop/website
bash scripts/deploy_lftp.sh
```
- 自动上传所有前端文件（index、css、js、auth、assets 等，详见脚本中 FILES 列表）
- 每个文件最多重试 3 次，失败自动清理残留锁文件
- 上传完成后自动验证所有文件的 HTTP 200 状态
- 支持 `--dry-run` 模式只预览不上传

#### 方式二：curl 单文件上传（备用）
```bash
curl -T index.html "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/index.html"
curl -T supabase-dashboard.html "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/supabase-dashboard.html"
curl -T insights.html "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/insights.html"
curl -T prompt-admin.html "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/prompt-admin.html"
curl -T dashboard.js "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/dashboard.js"
curl -T prompt-admin.js "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/prompt-admin.js"
curl -T style.css "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/style.css"
curl --ftp-create-dirs -T assets/data/dashboard-spec.json "ftp://<FTP_USER>:<FTP_PASS>@<FTP_HOST>/wwwroot/assets/data/dashboard-spec.json"
```

#### 方式二：用脚本一键部署
```bash
cd /Users/zhouhao/Desktop/website
python3 scripts/deploy_report_center.py --db-password "你的 Supabase 数据库密码"
```

可选参数：
- `--skip-db`：跳过数据库迁移
- `--skip-functions`：跳过 Edge Functions 发布
- `--skip-static`：跳过静态页 FTP 上传
- `--skip-link`：本地已执行过 `supabase link` 时使用
- `--dry-run`：只打印命令，不真正执行

### 4. 验证
- 数据看板点击 AI 分析后，应返回 report_slug
- 数据看板首屏与日期筛选应能正常返回聚合结果
- 洞察中心页面应能打开并展示 ai_reports 列表
- 报告详情页应能展示高消耗人群、动作建议、财务修正和原始 Markdown
- Prompt 管理台应能加载线上版本、保存草稿、预览分析、发布上线和回滚历史版本

### 4.2 Prompt 管理台说明
- Prompt 管理使用登录后下发的签名令牌；如果是旧登录会话，看不到权限时重新登录一次即可刷新令牌
- 默认所有已登录飞书账号都可进入 Prompt 管理；如需限制范围，可配置 `PROMPT_ADMIN_EMAILS` 或 `PROMPT_ADMIN_OPEN_IDS`
- 建议始终单独配置 `PROMPT_ADMIN_SIGNING_SECRET`，不要长期依赖 `FEISHU_APP_SECRET` 兜底签名

### 4.1 自动核验
```bash
cd /Users/zhouhao/Desktop/website
python3 scripts/verify_report_center.py
```

如需更细的回归核验（包括日期切换、CSV字段、AI分析、洞察中心跳转）：
```bash
python3 scripts/verify_dashboard_flow.py
```

如线上域名或 Supabase 项目地址变化，可覆盖参数：
```bash
python3 scripts/verify_report_center.py \
  --site-url "https://www.friends.wang" \
  --supabase-url "https://qjscsikithbxuxmjyjsp.supabase.co"
```

### 4.3 发布前统一检查

在正式 FTP 上传前，先跑统一检查入口：

```bash
cd /Users/zhouhao/Desktop/website
npm run check:release
```

如果要连线上关键路径一起检查：

```bash
npm run check:release:online
```

当前统一检查会覆盖：
- 关键静态文件存在性
- GenBI regression
- GenBI contract
- 数据看板单日 smoke 检查

## 密码保护
- 通用密码：**已从文档中移除，请在 CI Secrets 或密钥管理工具中查看**
- 用途：保护敏感页面，需要密码才能访问
- 实现：JavaScript 前端验证
- 已保护页面：rules-2026-03-11-data-fields.html（直播间数据报表字段全解析）
- **安全提醒**：旧密码已泄露（曾明文写在此文件中），建议立即轮换

## 注意事项
1. Edge Functions 源码（supabase/functions/）和迁移脚本（supabase/migrations/）仅用于本地开发，不要通过 FTP 上传到虚拟主机
2. Service Role Key 严禁泄露或硬编码到前端代码中
3. 部署完成后记得运行核验脚本确认功能正常

---

## 故障排查手册（2026-04-07 实战整理）

### 一、网站页面全部或部分 404

**现象**：首页/二级页面/登录页打开提示 404 或空白。

**根本原因**：西部数码 FTP 服务（Microsoft FTP Service）在多文件上传时极易卡死或报 425 错误，导致文件实际未写入，但脚本没有报错，造成静默丢失。

**处置步骤**：

1. 先批量验证哪些文件真的丢失：
   ```bash
   for f in index.html style.css script.js auth.js favicon.svg \
             insights.html supabase-dashboard.html \
             prompt-admin.html dashboard.js prompt-admin.js \
             assets/js/config.js assets/js/auth-helpers.js \
             auth/index.html auth/feishu/callback.html; do
     printf "%-40s " "$f"
     curl -s -o /dev/null -w "%{http_code}" "https://www.friends.wang/$f"
     echo ""
   done
   ```
2. 对每个返回 404 的文件，用 lftp 逐个重传：
   ```bash
   cd /Users/zhouhao/Desktop/website
   lftp -u "$FTP_USER","$FTP_PASS" "$FTP_HOST" \
     -e "set ftp:passive-mode true; set ssl:verify-certificate no; cd /wwwroot; put <文件名>; bye"
   ```
3. 若报 `550 file is being used by another process`，先删再传：
   ```bash
   # 删除锁文件
   lftp ... -e "cd /wwwroot; rm <文件名>; bye"
   # 等 10 秒后重传
   sleep 10 && lftp ... -e "cd /wwwroot; put <文件名>; bye"
   ```
4. 若 lftp 卡在 `[正等待传输完成]` 超过 3 分钟，强制终止并重传（文件数据可能已写入，先 curl 验证再决定是否重传）。

**预防**：每次部署统一使用 `bash scripts/deploy_lftp.sh`，该脚本含自动重试和 HTTP 验证。

---

### 二、飞书登录后回调报「登录接口返回了无法解析的响应」

**现象**：`auth/feishu/callback.html` 页面弹出此错误。

**根本原因**：`assets/js/config.js` 不存在（404），导致 `CONFIG.SB_URL` 为空字符串，回调页向错误 URL 发起请求，服务器返回 HTML 页面，JSON.parse 失败。

**处置**：确认以下两个文件都返回 200，若 404 则重传：
```
assets/js/config.js
assets/js/auth-helpers.js
```

---

### 三、本地调试飞书登录失败（redirect_uri 不匹配）

**现象**：点击「飞书登录」后，飞书提示授权失败或回调跳转 404。

**原因 1**：代码中 `REDIRECT_URI` 写死为线上地址，飞书白名单没有 localhost。

**已修复**：`auth/index.html` 已改为动态判断：
```javascript
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const REDIRECT_URI = encodeURIComponent(
  isLocal
    ? 'http://localhost:3000/auth/feishu/callback.html'
    : 'https://www.friends.wang/auth/feishu/callback.html'
);
```

**飞书平台配置**：已在 `cli_a93911f3a9ba5bd1` 的「安全设置 → 重定向 URL」中添加：
```
http://localhost:3000/auth/feishu/callback.html
```

**原因 2**：本地 HTTP 服务器运行在错误目录（家目录 `~`），导致 `/auth/feishu/callback.html` 404。

**正确启动方式**（必须指定项目目录）：
```bash
python3 -m http.server 3000 --directory /Users/zhouhao/.openclaw/workspace/website
```
然后访问 `http://localhost:3000/auth/index.html`。

> **禁止**直接在 `~` 下运行 `python3 -m http.server 3000`。

---

### 四、本地调试时洞察中心、数据看板数据加载失败（CORS 错误）

**现象**：页面登录成功但数据为空，浏览器控制台报 CORS 错误：
```
Access-Control-Allow-Origin: https://www.friends.wang
```
拒绝 `http://localhost:3000` 的请求。

**根本原因**：Edge Function 的 `CORS_HEADERS` 写死了生产域名，本地发出的请求被浏览器拦截。

**已修复**：以下 4 个 Edge Function 已改为动态 CORS，自动允许 localhost：
- `supabase/functions/dashboard-data/index.ts`
- `supabase/functions/ai-reports/index.ts`
- `supabase/functions/ai-analysis/index.ts`
- `supabase/functions/ai-prompts/index.js`

修复逻辑：
```typescript
const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return { 'Access-Control-Allow-Origin': allowed, ... };
}
```

**修改后须重新部署 Edge Functions**：
```bash
cd /Users/zhouhao/Desktop/website
supabase functions deploy dashboard-data
supabase functions deploy ai-reports
supabase functions deploy ai-analysis
```
