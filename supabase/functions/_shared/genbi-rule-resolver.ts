import type { GenbiIntent } from './genbi-intent.ts';
import { getGenbiSemanticConfig } from './genbi-semantic.ts';

type RuleResolverResult = {
  intent: GenbiIntent;
  ruleKey: string | null;
  version: string;
  rule: Record<string, unknown>;
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
    topDropCount: readNestedNumber(resolved.rule, ['output', 'topDropCount'], 3),
  };
}

export async function getWeakProductsRuleConfig() {
  const resolved = await resolveRuleByIntent('weak_products');
  return {
    ...resolved,
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
    topCount: readNestedNumber(resolved.rule, ['output', 'topCount'], 6),
    highlightCount: readNestedNumber(resolved.rule, ['output', 'highlightCount'], 3),
  };
}

export async function getProductSalesRuleConfig() {
  const resolved = await resolveRuleByIntent('product_sales');
  return {
    ...resolved,
    resultLimit: readNestedNumber(resolved.rule, ['output', 'resultLimit'], 1),
  };
}

export async function getPeriodicReportRuleConfig() {
  const resolved = await resolveRuleByIntent('weekly_report');
  return {
    ...resolved,
    topCrowdCount: readNestedNumber(resolved.rule, ['output', 'topCrowdCount'], 5),
    topProductCount: readNestedNumber(resolved.rule, ['output', 'topProductCount'], 5),
  };
}

export async function getLossReasonRuleConfig() {
  const resolved = await resolveRuleByIntent('loss_reason');
  return {
    ...resolved,
    topCrowdCount: readNestedNumber(resolved.rule, ['output', 'topCrowdCount'], 3),
    topProductCount: readNestedNumber(resolved.rule, ['output', 'topProductCount'], 3),
  };
}
