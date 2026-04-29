# 发布检查流程说明

## 概述

当前 `check:release` 已包含线上 smoke check 的能力，但默认跳过，容易让人误解为所有发布检查都已完成。希望通过两个命令把"代码可发布"和"线上已验证"区分开，降低发布风险。

## 命令说明

### 1. 发布前本地检查

```bash
npm run check:release
```

**执行内容：**
- ✓ 静态文件完整性检查
- ✓ 密钥扫描（防止敏感信息泄露）
- ✓ GenBI 回归测试
- ✓ GenBI 合约测试
- ✓ GenBI 动态规则测试
- ✓ 计划看板回归测试
- ✓ 计划看板合约测试
- ✓ 计划看板 UI 检查
- ✓ 安全合约测试
- ⊘ Dashboard smoke test（默认跳过）
- ⊘ 线上路径检查（默认跳过）

**特点：**
- 完全离线可运行，不依赖网络
- 稳定的本地发布前检查
- 命令失败时返回非 0 exit code，方便接入 CI/CD

### 2. 部署后线上冒烟检查

```bash
npm run check:release:online
```

**执行内容：**
- 完整执行 `npm run check:release` 的所有检查
- ✓ Dashboard smoke test
- ✓ 线上关键页面和接口可访问性验证

**特点：**
- 用于部署后验证线上站点
- 需要网络连接
- 命令失败时返回非 0 exit code

## 使用流程

### 发布前

```bash
# 1. 运行本地发布检查
npm run check:release

# 确保所有检查通过后，再进行部署
```

### 部署后

```bash
# 2. 运行线上冒烟检查
npm run check:release:online

# 验证线上站点关键功能正常
```

## 输出说明

### 本地检查通过
```
[done] local release checks passed
[info] run `npm run check:release:online` after deployment to verify online site
```

### 线上冒烟检查通过
```
[done] online smoke checks passed
```

## CI/CD 集成建议

```yaml
# 示例：GitHub Actions
- name: Release Check
  run: npm run check:release

- name: Deploy
  run: ./deploy.sh

- name: Online Smoke Check
  run: npm run check:release:online
```

## 注意事项

1. **必须顺序执行**：先跑 `check:release`，部署后再跑 `check:release:online`
2. **失败处理**：任何检查失败都会返回非 0 exit code，阻断后续流程
3. **环境变量**：可通过 `RELEASE_CHECK_DASHBOARD_SMOKE=1` 单独启用 dashboard smoke test
4. **自定义站点**：可通过 `--site-url` 参数指定检查的线上地址

## 配置说明

检查配置位于 `tools/checks/release-check.config.json`，包含：
- `staticFiles`: 本地静态文件清单
- `onlinePaths`: 线上需要验证的路径清单
- `dashboardSmoke`: smoke test 的时间范围配置