import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

import { detectDateRange, getLastMonthRange, getLastWeekRange, getYesterdayRange } from '../functions/_shared/genbi-time.ts';
// 意图识别已完全动态化（仅依赖 MiniMax + 数据库），此回归测试不再直接验证意图。

type DateRangeCase = {
  name: string;
  question: string;
  expected: {
    start: string;
    end: string;
    label: string;
  };
};

type IntentCase = {
  name: string;
  question: string;
  expectedIntent: string;
};

type RegressionCases = {
  dateRangeCases: DateRangeCase[];
  // intentCases 已废弃：意图识别动态化后无法在离线回归中验证，保留字段仅为向后兼容
  intentCases?: IntentCase[];
};

type SemanticConfig = {
  intentGroups?: Array<{
    key?: string;
    label?: string;
    examples?: string[];
  }>;
  rules?: Record<string, unknown>;
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CASES_PATH = path.join(ROOT, 'tests', 'genbi-regression.cases.json');
const SEMANTIC_PATH = path.join(ROOT, '..', 'assets', 'data', 'genbi-semantic.json');

function resolveExpectedDateRange(testCase: DateRangeCase): DateRangeCase['expected'] {
  if (testCase.name === 'last_week_range') return getLastWeekRange();
  if (testCase.name === 'last_month_range') return getLastMonthRange();
  if (testCase.name === 'yesterday_range') return getYesterdayRange();
  return testCase.expected;
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function validateDateRangeCases(cases: DateRangeCase[]) {
  cases.forEach((testCase) => {
    const actual = detectDateRange(testCase.question);
    const expected = resolveExpectedDateRange(testCase);
    assert.equal(actual.start, expected.start, `[dateRange:${testCase.name}] start mismatch`);
    assert.equal(actual.end, expected.end, `[dateRange:${testCase.name}] end mismatch`);
    assert.equal(actual.label, expected.label, `[dateRange:${testCase.name}] label mismatch`);
  });
}

function validateSemanticExamples(_semantic: SemanticConfig) {
  // 意图识别已完全动态化，离线回归不再断言 example 预期意图。
  // 如需验证意图识别，请在联调环境直接调用 detectIntentByAI 。
}

function validateRuleConfig(semantic: SemanticConfig) {
  const rules = semantic.rules ?? {};
  assert.ok(rules.crowdBudget, '[rules] missing crowdBudget');
  assert.ok(rules.weakProducts, '[rules] missing weakProducts');
  assert.ok(rules.productPotential, '[rules] missing productPotential');
  assert.ok(rules.periodicReport, '[rules] missing periodicReport');
  assert.ok(rules.lossReason, '[rules] missing lossReason');
}

async function main() {
  const cases = await readJson<RegressionCases>(CASES_PATH);
  const semantic = await readJson<SemanticConfig>(SEMANTIC_PATH);

  validateDateRangeCases(cases.dateRangeCases);
  validateSemanticExamples(semantic);
  validateRuleConfig(semantic);

  const summary = {
    dateRangeCases: cases.dateRangeCases.length,
    intentCases: 'skipped (dynamic AI intent recognition)',
    semanticExampleCases: 'skipped (dynamic AI intent recognition)',
    ruleSections: Object.keys(semantic.rules ?? {}).length,
  };

  console.log(`GenBI regression passed: ${JSON.stringify(summary)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
