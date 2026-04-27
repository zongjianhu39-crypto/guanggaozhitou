import type { GenbiIntent } from './genbi-intent.ts';
import { getGenbiSemanticConfig } from './genbi-semantic.ts';

type RuleResolverResult = {
  intent: GenbiIntent;
  ruleKey: string | null;
  version: string;
  rule: Record<string, unknown>;
};

type DataScopeFlag = 'ads' | 'crowd' | 'single';

const METRIC_COLUMN_LABELS: Record<string, string[]> = {
  ad_cost: ['花费', '昨日花费', '前一日花费', '变化额'],
  breakeven_roi: ['盈亏平衡ROI'],
  order_cost: ['订单成本', '商品订单成本'],
  direct_roi: ['直接ROI'],
  product_direct_roi: ['商品直接ROI'],
  gmv: ['成交金额', '总成交金额'],
  product_direct_gmv: ['商品直接成交金额'],
  product_orders: ['商品直接成交笔数'],
  orders: ['成交笔数', '商品直接成交笔数'],
  crowd_cost_share: ['花费占比', '人群花费占比'],
  wow: ['周环比'],
  mom: ['月环比'],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readNestedNumber(value: unknown, path: string[], fallback: number): number {
  let current = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  const num = Number(current);
  return Number.isFinite(num) ? num : fallback;
}

function readNestedStringArray(value: unknown, path: string[], fallback: string[] = []): string[] {
  let current = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return Array.isArray(current)
    ? current.map((item) => String(item || '').trim()).filter(Boolean)
    : fallback;
}

function readStrategyMetrics(rule: Record<string, unknown>): string[] {
  const strategy = asRecord(rule.strategy);
  return Array.from(new Set([
    ...readNestedStringArray(rule, ['strategy', 'metrics']),
    String(strategy.primaryMetric || '').trim(),
    String(strategy.secondaryMetric || '').trim(),
  ].filter(Boolean)));
}

function getScopeFlags(rule: Record<string, unknown>, fallback: DataScopeFlag[]) {
  const dataScope = readNestedStringArray(rule, ['dataScope'], fallback);
  const scopeSet = new Set(dataScope.filter((item): item is DataScopeFlag => ['ads', 'crowd', 'single'].includes(item)));
  return {
    ads: scopeSet.has('ads'),
    crowd: scopeSet.has('crowd'),
    single: scopeSet.has('single'),
  };
}

function getAllowedTableColumns(rule: Record<string, unknown>): Set<string> | null {
  const outputColumns = readNestedStringArray(rule, ['output', 'columns']);
  const metrics = readStrategyMetrics(rule);
  if (!outputColumns.length && !metrics.length) return null;

  const allowed = new Set(['指标', '数值', '人群分层', '商品']);
  outputColumns.forEach((column) => allowed.add(column));
  metrics.forEach((metric) => {
    (METRIC_COLUMN_LABELS[metric] || []).forEach((label) => allowed.add(label));
  });
  return allowed;
}

export async function resolveRuleByIntent(intent: GenbiIntent): Promise<RuleResolverResult> {
  const semantic = await getGenbiSemanticConfig();
  const intentRules = asRecord(semantic.intentRules);
  const rules = asRecord(semantic.rules);
  const ruleVersions = asRecord(semantic.ruleVersions);

  const ruleKey = String(intentRules[intent] || '').trim() || null;
  const rule = ruleKey ? asRecord(rules[ruleKey]) : {};
  const version = String(rule.version || (ruleKey ? ruleVersions[ruleKey] : '') || 'v1').trim() || 'v1';

  return {
    intent,
    ruleKey,
    version,
    rule,
  };
}

export async function getCrowdBudgetRuleConfig() {
  const resolved = await resolveRuleByIntent('crowd_budget');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['crowd']),
    minCostShare: readNestedNumber(resolved.rule, ['filters', 'minCostShare'], 0.05),
    topIncreaseCount: readNestedNumber(resolved.rule, ['output', 'topIncreaseCount'], 3),
    topDecreaseCount: readNestedNumber(resolved.rule, ['output', 'topDecreaseCount'], 3),
    tableLimit: readNestedNumber(resolved.rule, ['output', 'tableLimit'], 10),
    excludeLayers: readNestedStringArray(resolved.rule, ['filters', 'excludeLayers'], ['未知']),
  };
}

export async function getDailyDropReasonRuleConfig() {
  const resolved = await resolveRuleByIntent('daily_drop_reason');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['crowd']),
    topDropCount: readNestedNumber(resolved.rule, ['output', 'topDropCount'], 3),
  };
}

export async function getCrowdMixRuleConfig() {
  const resolved = await resolveRuleByIntent('crowd_mix');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['crowd']),
  };
}

export async function getWeakProductsRuleConfig() {
  const resolved = await resolveRuleByIntent('weak_products');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['single']),
    minFocusPoolSize: readNestedNumber(resolved.rule, ['filters', 'minFocusPoolSize'], 20),
    focusPoolCostCoverage: readNestedNumber(resolved.rule, ['filters', 'focusPoolCostCoverage'], 0.85),
    topCount: readNestedNumber(resolved.rule, ['output', 'topCount'], 8),
    highlightCount: readNestedNumber(resolved.rule, ['output', 'highlightCount'], 3),
  };
}

export async function getProductPotentialRuleConfig() {
  const resolved = await resolveRuleByIntent('product_potential');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['single']),
    topCount: readNestedNumber(resolved.rule, ['output', 'topCount'], 6),
    highlightCount: readNestedNumber(resolved.rule, ['output', 'highlightCount'], 3),
  };
}

export async function getProductSalesRuleConfig() {
  const resolved = await resolveRuleByIntent('product_sales');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['single']),
    resultLimit: readNestedNumber(resolved.rule, ['output', 'resultLimit'], 1),
  };
}

export async function getPeriodicReportRuleConfig() {
  const resolved = await resolveRuleByIntent('weekly_report');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['ads', 'crowd', 'single']),
    topCrowdCount: readNestedNumber(resolved.rule, ['output', 'topCrowdCount'], 5),
    topProductCount: readNestedNumber(resolved.rule, ['output', 'topProductCount'], 5),
  };
}

export async function getLossReasonRuleConfig() {
  const resolved = await resolveRuleByIntent('loss_reason');
  return {
    ...resolved,
    dataScopeFlags: getScopeFlags(resolved.rule, ['ads', 'crowd', 'single']),
    topCrowdCount: readNestedNumber(resolved.rule, ['output', 'topCrowdCount'], 3),
    topProductCount: readNestedNumber(resolved.rule, ['output', 'topProductCount'], 3),
  };
}

export async function applyRuleOutputConfig(intent: GenbiIntent, result: unknown) {
  const resolved = await resolveRuleByIntent(intent);
  const allowedColumns = getAllowedTableColumns(resolved.rule);
  const safeResult = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const notes = Array.isArray(safeResult.notes) ? safeResult.notes : [];
  const metricKeys = readStrategyMetrics(resolved.rule);

  if (metricKeys.length) {
    safeResult.notes = [
      ...notes,
      `当前规则指标：${metricKeys.join('、')}`,
    ];
  }

  if (!allowedColumns || !Array.isArray(safeResult.tables)) {
    return safeResult;
  }

  safeResult.tables = safeResult.tables.map((table) => {
    const safeTable = table && typeof table === 'object' ? table as Record<string, unknown> : {};
    const columns = Array.isArray(safeTable.columns)
      ? safeTable.columns.map((column) => String(column)).filter((column) => allowedColumns.has(column))
      : [];
    if (!columns.length) return table;
    const rows = Array.isArray(safeTable.rows)
      ? safeTable.rows.map((row) => {
          const source = asRecord(row);
          const next: Record<string, unknown> = {};
          columns.forEach((column) => {
            next[column] = source[column];
          });
          return next;
        })
      : [];
    return {
      ...safeTable,
      columns,
      rows,
    };
  });

  return safeResult;
}
