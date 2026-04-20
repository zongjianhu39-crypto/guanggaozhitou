# 网站目录与文件说明

## 1. 网站现在在哪个文件夹

当前网站项目的本地源码根目录在：

- /Users/zhouhao/.openclaw/workspace/website

这就是现在维护网站的主目录，前端页面、静态资源、部署脚本、Supabase 后端函数、数据库迁移都在这里。

可以把它理解成三层：

1. 本地源码目录：/Users/zhouhao/.openclaw/workspace/website
2. 线上静态站目录：虚拟主机 /wwwroot
3. 线上后端目录：Supabase 项目中的 Edge Functions 和数据库

其中：

- 你平时改代码，主要改本地源码目录。
- 纯前端文件通过 FTP 上传到虚拟主机。
- Supabase 相关文件通过 Supabase CLI 发布，不走 FTP。

---

## 2. 项目顶层结构

### 2.1 顶层文件夹

| 路径 | 作用 |
|------|------|
| tools/ | 工程检查、调试工具与历史部署脚本归档 |
| assets/ | 前端静态资源目录，放配置、图片、共享 JSON 规则文件 |
| auth/ | 登录相关页面，主要是飞书登录入口和回调页 |
| docs/ | 项目文档目录，放业务规范、实施方案、说明文档 |
| scripts/ | 部署、核验、回归检查脚本 |
| supabase/ | Supabase 后端目录，包含函数、迁移、数据文件 |

### 2.2 顶层页面与脚本文件

| 文件 | 作用 |
|------|------|
| index.html | 网站首页 |
| supabase-dashboard.html | 投放数据看板页面，当前投放分析和人群分析主页面 |
| insights.html | 洞察中心页面，展示 AI 报告汇总 |
| prompt-admin.html | Prompt 管理台页面 |
| genbi.html | 智能问数页面 |
| metric-rules.html | 指标规则页面 |
| plan-dashboard.html | 计划拆解看板页面 |
| plan-dashboard-preview.html | 计划拆解预览页面 |
| style.css | 全站公共样式 |
| script.js | 全站通用前端脚本 |
| dashboard.js | 数据看板专用前端逻辑 |
| prompt-admin.js | Prompt 管理台专用前端逻辑 |
| auth.js | 登录校验、登录态判断相关脚本 |
| favicon.svg | 网站图标 |
| robots.txt | 搜索引擎抓取规则 |
| generate_ppt.py | 内部演示文稿生成脚本 |

### 2.3 顶层说明类文件

| 文件 | 作用 |
|------|------|
| .env.local | 本地环境变量文件，通常只给本机开发使用（不在仓库中） |

### 2.4 顶层可忽略文件

| 文件或目录 | 说明 |
|------|------|
| .DS_Store | macOS 自动生成文件，无业务意义 |

---

## 3. 前端目录说明

### 3.1 assets/

这是前端静态资源目录，放不会直接作为独立页面打开、但会被页面引用的资源。

#### assets/ 下的文件夹和文件

| 路径 | 作用 |
|------|------|
| assets/js/ | 放前端配置和辅助脚本 |
| assets/data/ | 放前后端共用的数据配置文件 |
| assets/hero-dashboard-scene.svg | 首页或某些页面使用的 SVG 插图 |
| assets/hero-illustration.svg | 页面插图资源 |
| assets/hero-image.jpg | 页面图片资源 |

#### assets/js/

| 文件 | 作用 |
|------|------|
| assets/js/config.js | 前端运行配置，集中放 Supabase 地址、匿名 key、允许域名等 |
| assets/js/auth-helpers.js | 登录相关的辅助函数 |

#### assets/data/

| 文件 | 作用 |
|------|------|
| assets/data/dashboard-spec.json | 数据看板共享规则文件，当前用于配置公式展示、plan_type 规则、人群分层规则 |

### 3.2 auth/

这是登录入口目录，主要是飞书登录流程。

| 路径 | 作用 |
|------|------|
| auth/index.html | 飞书登录页 |
| auth/feishu/callback.html | 飞书 OAuth 登录回调页 |

---

## 4. 文档目录说明

docs/ 目录主要放当前说明、工单记录、模板和历史归档。先看 `docs/README.md`，再进入对应子目录。

| 文件 | 作用 |
|------|------|
| docs/README.md | 文档目录索引和事实源优先级 |
| docs/current/ | 当前仍在维护的说明文档 |
| docs/work-orders/ | 驾驶舱、问题排查、上线和回滚记录 |
| docs/archive/ | 历史日志、旧说明、被替代文档 |
| docs/templates/ | 可复制复用的文档模板 |
| docs/current/报表字段及关系-标准文档.md | 投放数据字段和业务口径主文档 |
| docs/archive/dashboard-field-standard-406.md | 旧版/迁入版字段标准说明；独有维护说明已合并到主字段文档 |

如果你后续要找“业务口径”和“字段标准”，优先看：

- docs/current/报表字段及关系-标准文档.md
- assets/data/dashboard-spec.json

---

## 5. 脚本目录说明

scripts/ 目录主要放部署、核验和问题排查脚本。

| 文件 | 作用 |
|------|------|
| scripts/deploy_lftp.sh | 当前主用的静态站 FTP 部署脚本 |
| tools/debug/dashboard_regression_check.mjs | 看板回归检查脚本 |
| tools/debug/supabase_dashboard_query.mjs | 看板接口查询调试脚本 |
| tools/checks/check-no-keys.sh | 密钥扫描脚本，防止敏感信息误提交 |
| tools/deploy/archive/ | 历史部署脚本归档 |
| tools/archive/ | 历史启动/停止脚本归档 |

---

## 6. Supabase 后端目录说明

supabase/ 目录是网站后端能力所在，包含数据文件、Edge Functions 和数据库迁移。

### 7.1 supabase/ 顶层

| 路径 | 作用 |
|------|------|
| supabase/data/ | 后端使用的数据文件 |
| supabase/functions/ | Edge Functions 源码目录 |
| supabase/migrations/ | 数据库迁移脚本目录 |
| supabase/.temp/ | Supabase CLI 运行时生成目录，可忽略 |

### 7.2 supabase/data/

| 文件 | 作用 |
|------|------|
| supabase/data/prompts.json | 较早期的 Prompt 数据文件，供 ai-prompts 函数读取 |

### 7.3 supabase/functions/

这是所有 Edge Functions 所在目录。

| 路径 | 作用 |
|------|------|
| supabase/functions/_shared/ | 多个函数共用的工具模块 |
| supabase/functions/ai-analysis/ | AI 分析函数源码 |
| supabase/functions/ai-prompt-admin/ | Prompt 管理后台函数源码 |
| supabase/functions/ai-prompts/ | 较早期 Prompt 查询函数源码 |
| supabase/functions/ai-reports/ | 洞察中心报告查询函数源码 |
| supabase/functions/dashboard-data/ | 数据看板聚合接口源码 |
| supabase/functions/feishu-auth/ | 飞书登录认证函数源码 |

#### supabase/functions/_shared/

| 文件 | 作用 |
|------|------|
| supabase/functions/_shared/supabase-client.ts | Supabase 地址、服务端 key、请求头等共享封装 |
| supabase/functions/_shared/prompt-admin-auth.ts | Prompt 管理权限令牌的签发和校验 |
| supabase/functions/_shared/prompt-store.ts | Prompt 模板、版本、发布、回滚的读写逻辑 |
| supabase/functions/_shared/dashboard-spec.ts | 数据看板共享规则加载器，读取 dashboard-spec.json 并提供分类工具 |

#### supabase/functions/ai-analysis/

| 文件 | 作用 |
|------|------|
| supabase/functions/ai-analysis/index.ts | AI 分析主函数，负责拉取数据、构造分析输入、调用模型并落库 |
| supabase/functions/ai-analysis/prompt-templates.ts | AI 分析 Prompt 模板和变量定义 |

#### supabase/functions/ai-prompt-admin/

| 文件 | 作用 |
|------|------|
| supabase/functions/ai-prompt-admin/index.ts | Prompt 管理接口，负责读取、保存草稿、发布、回滚 |

#### supabase/functions/ai-prompts/

| 文件 | 作用 |
|------|------|
| supabase/functions/ai-prompts/index.js | 较早期 Prompt 查询函数，支持读取最新模板和预览渲染 |

#### supabase/functions/ai-reports/

| 文件 | 作用 |
|------|------|
| supabase/functions/ai-reports/index.ts | 洞察中心列表和详情查询接口 |

#### supabase/functions/dashboard-data/

| 文件 | 作用 |
|------|------|
| supabase/functions/dashboard-data/index.ts | 数据看板核心接口，负责读取投放、淘宝直播、财务数据并聚合出 ads 和 crowd 结果 |

#### supabase/functions/feishu-auth/

| 文件 | 作用 |
|------|------|
| supabase/functions/feishu-auth/index.ts | 飞书登录函数，负责 code 换 token、读取用户信息、下发管理令牌 |

### 7.4 supabase/migrations/

| 文件 | 作用 |
|------|------|
| supabase/migrations/20260403_create_ai_reports.sql | 创建 AI 报告中心相关表，如 ai_report_runs、ai_reports、ai_playbooks |
| supabase/migrations/20260404_create_ai_prompt_management.sql | 创建 Prompt 管理相关表，如 ai_prompt_templates、ai_prompt_versions |
| supabase/migrations/20260406_add_ai_reports_fulltext_search.sql | 为 ai_reports 增加全文搜索和 trigram 索引 |

---

## 8. 按功能看，改哪里最合适

### 8.1 如果你要改页面展示

优先看这些文件：

| 功能 | 主要文件 |
|------|------|
| 首页 | index.html, style.css, script.js |
| 数据看板页面结构 | supabase-dashboard.html |
| 数据看板交互逻辑 | dashboard.js |
| 洞察中心 | insights.html |
| Prompt 管理台 | prompt-admin.html, prompt-admin.js |
| 登录态判断 | auth.js, auth/index.html, auth/feishu/callback.html |

### 8.2 如果你要改看板的字段、公式、分类规则

优先看这些文件：

| 类型 | 主要文件 |
|------|------|
| 业务标准文档 | docs/current/报表字段及关系-标准文档.md |
| 机器可执行规则 | assets/data/dashboard-spec.json |
| 后端规则加载 | supabase/functions/_shared/dashboard-spec.ts |
| 看板聚合接口 | supabase/functions/dashboard-data/index.ts |
| 前端公式展示 | dashboard.js, supabase-dashboard.html |

### 8.3 如果你要改 AI 报告和 Prompt 管理

优先看这些文件：

| 功能 | 主要文件 |
|------|------|
| AI 分析 | supabase/functions/ai-analysis/index.ts |
| Prompt 模板 | supabase/functions/ai-analysis/prompt-templates.ts |
| Prompt 管理接口 | supabase/functions/ai-prompt-admin/index.ts |
| Prompt 存储逻辑 | supabase/functions/_shared/prompt-store.ts |
| Prompt 管理页面 | prompt-admin.html, prompt-admin.js |
| 洞察中心接口 | supabase/functions/ai-reports/index.ts |

### 8.4 如果你要改部署流程

优先看这些文件：

| 功能 | 主要文件 |
|------|------|
| 手动部署说明 | docs/current/DEPLOY.md |
| 静态文件 FTP 部署 | scripts/deploy_lftp.sh |
| 上线前检查 | npm run check:release |

---

## 9. 当前项目里最重要的几个文件

如果只记最核心的一批，可以优先记下面这些：

| 文件 | 为什么重要 |
|------|------|
| supabase-dashboard.html | 看板页面骨架就在这里 |
| dashboard.js | 看板前端逻辑基本都在这里 |
| assets/data/dashboard-spec.json | 当前字段公式和人群规则的共享配置中心 |
| docs/current/报表字段及关系-标准文档.md | 当前业务标准文档 |
| supabase/functions/dashboard-data/index.ts | 看板数据从这里聚合出来 |
| supabase/functions/_shared/dashboard-spec.ts | 共享规则从这里被后端加载 |
| prompt-admin.html | Prompt 管理台页面入口 |
| prompt-admin.js | Prompt 管理台前端逻辑 |
| supabase/functions/ai-analysis/index.ts | AI 分析主函数 |
| docs/current/DEPLOY.md | 部署总说明 |
| scripts/deploy_lftp.sh | 当前静态站主用部署脚本 |

---

## 10. 一句话总结

这个项目的源码主目录就是 /Users/zhouhao/.openclaw/workspace/website。

- 页面文件主要在根目录和 auth/
- 静态资源主要在 assets/
- 文档主要在 docs/
- 部署和核验脚本主要在 scripts/
- 真正的后端逻辑主要在 supabase/functions/
- 数据库结构变更主要在 supabase/migrations/

如果后续你想继续，我可以在这份文档基础上再补一版“从需求到改文件”的导航版，比如“想改登录、想改看板、想改 Prompt、想改部署，分别按什么顺序看哪些文件”。
