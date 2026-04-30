# Website 代码审查标准 — 完成报告

> 项目：website（交个朋友投放数据平台）
> 完成时间：2026-04-30

## 产出文件

| 文件 | 用途 |
|------|------|
| `docs/current/CODE-REVIEW-STANDARD.md` | 完整的代码审查标准和流程文档 |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR 描述模板 |
| `.github/CODEOWNERS` | 代码审查归属（核心模块指定审查者） |
| `tools/hooks/pre-commit` | pre-commit hook（密钥扫描 + 大文件检查） |

## 标准要点

1. **三级审查制**：L1 自动审查（CI）→ L2 同行审查（1人 Approve）→ L3 专家审查（安全/DB/AI 模块）
2. **前后端分离清单**：后端 TS 专项（类型完整、Edge Function 规范、数据库操作）+ 前端 JS 专项（IIFE 模式、DOM 安全、样式规范）
3. **安全一票否决**：密钥泄露、XSS、SQL 注入等 P0 项不通过则合并阻断
4. **Commit 规范**：从 "update website" 升级为 Conventional Commits（feat/fix/refactor 等）
5. **落地路线图**：第1周安装 hook + 分支保护 → 第2周配置 ESLint/Prettier → 第3-4周 CI 集成 → 第2月全面覆盖

## 项目现状诊断

- 🔴 无 Linter/Formatter → 代码风格靠人工约定
- 🔴 无 PR 审查流程 → 直接推送 main
- 🔴 无 Pre-commit Hook → 密钥泄露无拦截
- 🟡 Commit 信息无规范 → 全部是 "update website"
- 🟡 无 TypeScript 严格配置 → 后端 TS 缺编译检查
- 🟡 前端零测试 → JS 模块无测试覆盖
