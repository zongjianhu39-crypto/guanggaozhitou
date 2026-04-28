import assert from 'node:assert/strict';

import { buildDynamicAnswer } from '../functions/genbi-rules/dynamic.ts';

const range = {
  start: '2026-04-01',
  end: '2026-04-07',
  label: '2026-04-01 至 2026-04-07',
};

// 模拟 adapter 输出（camelCase + 中文键双向兼容，与 genbi-payload-adapters.ts 保持一致）
const crowdSample = [
  { layer: '老客',     cost: 120000, amount: 460000, orders: 1200, orderCost: 100, costShare: 0.40, '花费': 120000, '成交金额': 460000 },
  { layer: '新客',     cost:  90000, amount: 210000, orders:  500, orderCost: 180, costShare: 0.30, '花费':  90000, '成交金额': 210000 },
  { layer: '兴趣新客',  cost:  70000, amount: 160000, orders:  410, orderCost: 171, costShare: 0.23, '花费':  70000, '成交金额': 160000 },
  { layer: '泛人群',   cost:  20000, amount:  40000, orders:   80, orderCost: 250, costShare: 0.07, '花费':  20000, '成交金额':  40000 },
];

// 用例 1：带 minCostShare 过滤 + topCount 裁剪
function testCrowdBudgetFilter() {
  const rule = {
    label: '人群预算建议',
    dataScope: ['crowd'],
    strategy: {
      metrics: ['ad_cost', 'gmv'],
      primaryMetric: 'ad_cost',
      secondaryMetric: 'gmv',
    },
    filters: {
      minCostShare: 0.1, // 排除占比 < 10% 的人群，会干掉「泛人群」(0.07)
    },
    output: {
      tableTitle: '人群分层效率',
      topCount: 2,
    },
  };
  const envelope = buildDynamicAnswer(
    'crowd_budget',
    'crowdBudget',
    rule,
    range,
    'crowd',
    crowdSample.map((item) => ({ ...item })) as any,
  ) as any;

  assert.equal(envelope.intent, 'crowd_budget');
  assert.ok(Array.isArray(envelope.tables), 'tables should be array');
  assert.ok(envelope.rule_execution, 'rule_execution meta missing');
  assert.equal(envelope.rule_execution.originalCount, 4, 'originalCount mismatch');
  // filteredCount 反映的是过滤后的完整集合。过滤掉 0.07 占比的「泛人群」，剩 3 条。
  // topCount 仅影响表格展示行数，下方单独断言。
  assert.equal(envelope.rule_execution.filteredCount, 3, 'filteredCount should reflect rows after filter (not topCount)');
  assert.equal(envelope.rule_execution.topCount, 2, 'topCount should echo rule output config');
  assert.equal(envelope.rule_execution.primaryMetric, 'ad_cost');
  assert.ok(
    Array.isArray(envelope.rule_execution.filters) && envelope.rule_execution.filters.length > 0,
    'filters counters should be recorded',
  );
  const primaryTable = envelope.tables && envelope.tables[0];
  assert.ok(primaryTable && Array.isArray(primaryTable.rows), 'primary table missing');
  assert.ok(primaryTable.rows.length <= 2, `table rows should be capped by topCount, got ${primaryTable.rows.length}`);
}

// 用例 2：requireFinitePrimaryMetric 默认开启，primary 指标缺失数据全被过滤
function testRequireFinitePrimaryMetricDefault() {
  const rule = {
    dataScope: ['crowd'],
    strategy: { primaryMetric: 'ad_cost' },
    filters: {},
    output: {},
  };
  const data = [
    { layer: 'X' }, // 没有 cost / 花费 / ad_cost
    { layer: 'Y' },
  ];
  const envelope = buildDynamicAnswer(
    'crowd_budget',
    'ruleA',
    rule,
    range,
    'crowd',
    data as any,
  ) as any;

  assert.equal(envelope.rule_execution.originalCount, 2);
  assert.equal(envelope.rule_execution.filteredCount, 0, 'empty primary metric should be filtered by default');
}

// 用例 3：filters.requireFinitePrimaryMetric = false 时关闭该默认行为
function testRequireFinitePrimaryMetricDisabled() {
  const rule = {
    dataScope: ['crowd'],
    strategy: { primaryMetric: 'ad_cost' },
    filters: { requireFinitePrimaryMetric: false },
    output: {},
  };
  const data = [
    { layer: 'X' },
    { layer: 'Y' },
  ];
  const envelope = buildDynamicAnswer(
    'crowd_budget',
    'ruleB',
    rule,
    range,
    'crowd',
    data as any,
  ) as any;
  assert.equal(envelope.rule_execution.filteredCount, 2, 'should keep rows when flag explicitly disabled');
}

// 用例 4：filterCounters 能追踪每一步
function testFilterCountersTraced() {
  const rule = {
    dataScope: ['crowd'],
    strategy: { primaryMetric: 'ad_cost' },
    filters: {
      minCostShare: 0.1,
    },
    output: {
      topCount: 10,
    },
  };
  const envelope = buildDynamicAnswer(
    'crowd_budget',
    'ruleC',
    rule,
    range,
    'crowd',
    crowdSample.map((item) => ({ ...item })) as any,
  ) as any;

  const counters = envelope.rule_execution.filters;
  assert.ok(Array.isArray(counters) && counters.length >= 1, 'counters should include at least one step');
  counters.forEach((counter: any, idx: number) => {
    assert.ok(typeof counter.step === 'string' && counter.step.length > 0, `step missing @${idx}`);
    assert.ok(Number.isFinite(counter.before), `before missing @${idx}`);
    assert.ok(Number.isFinite(counter.after), `after missing @${idx}`);
    assert.ok(counter.after <= counter.before, `after should <= before @${idx}`);
  });
}

function main() {
  testCrowdBudgetFilter();
  testRequireFinitePrimaryMetricDefault();
  testRequireFinitePrimaryMetricDisabled();
  testFilterCountersTraced();
  console.log(
    `GenBI dynamic rule tests passed: ${JSON.stringify({
      checked: [
        'crowd_budget_filter',
        'require_finite_primary_default',
        'require_finite_primary_disabled',
        'filter_counters_traced',
      ].length,
    })}`,
  );
}

main();
