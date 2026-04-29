import assert from 'node:assert/strict';

import { buildDynamicAnswer } from '../functions/genbi-rules/dynamic.ts';

const range = {
  start: '2026-04-01',
  end: '2026-04-07',
  label: '2026-04-01 至 2026-04-07',
};

const crowdSummary = [
  { layer: '老客', cost: 120000, amount: 460000, orders: 1200, orderCost: 100, costShare: 0.40, '花费': 120000, '总成交金额': 460000 },
  { layer: '新客', cost: 90000, amount: 210000, orders: 500, orderCost: 180, costShare: 0.30, '花费': 90000, '总成交金额': 210000 },
  { layer: '兴趣新客', cost: 70000, amount: 160000, orders: 410, orderCost: 171, costShare: 0.23, '花费': 70000, '总成交金额': 160000 },
  { layer: '泛人群', cost: 30000, amount: 40000, orders: 80, orderCost: 375, costShare: 0.07, '花费': 30000, '总成交金额': 40000 },
];

const products = [
  { productName: '商品A', cost: 180000, productOrders: 400, productAmount: 120000, productDirectRoi: 0.67, orderCost: 450 },
  { productName: '商品B', cost: 150000, productOrders: 900, productAmount: 480000, productDirectRoi: 3.2, orderCost: 167 },
  { productName: '商品C', cost: 90000, productOrders: 120, productAmount: 40000, productDirectRoi: 0.44, orderCost: 750 },
  { productName: '商品D', cost: 60000, productOrders: 300, productAmount: 200000, productDirectRoi: 3.33, orderCost: 200 },
];

function assertBasicEnvelope(payload: any, expectedIntent: string, expectedTitle: string) {
  assert.equal(payload.success, true);
  assert.equal(payload.intent, expectedIntent);
  assert.equal(payload.title, expectedTitle);
  assert.ok(typeof payload.answer === 'string' && payload.answer.length > 0);
  assert.equal(payload.range?.start, range.start);
  assert.equal(payload.range?.end, range.end);
  assert.ok(Array.isArray(payload.highlights));
  assert.ok(Array.isArray(payload.tables));
  assert.ok(Array.isArray(payload.notes));
  assert.ok(payload.rule_execution, 'rule_execution metadata should be present');
}

function assertPrimaryTable(payload: any, expectedTitle: string, minRows = 1) {
  const table = payload.tables?.[0];
  assert.ok(table, `missing table: ${expectedTitle}`);
  assert.equal(table.title, expectedTitle);
  assert.ok(Array.isArray(table.columns) && table.columns.length > 0, `missing columns: ${expectedTitle}`);
  assert.ok(Array.isArray(table.rows) && table.rows.length >= minRows, `missing rows: ${expectedTitle}`);
  return table;
}

function buildCase(intent: string, ruleKey: string, rule: Record<string, unknown>, dataScope: 'crowd' | 'single' | 'ads', data: any[]) {
  return buildDynamicAnswer(intent, ruleKey, rule, range, dataScope, data.map((item) => ({ ...item }))) as any;
}

function testCrowdBudgetContract() {
  const payload = buildCase(
    'crowd_budget',
    'crowdBudget',
    {
      label: '人群预算建议',
      dataScope: ['crowd'],
      strategy: {
        metrics: ['order_cost', 'crowd_cost_share', 'ad_cost'],
        primaryMetric: 'order_cost',
        secondaryMetric: 'crowd_cost_share',
        increaseSort: 'primary_asc',
      },
      filters: { minCostShare: 0.1 },
      output: { topCount: 3, highlightCount: 2 },
    },
    'crowd',
    crowdSummary,
  );

  assertBasicEnvelope(payload, 'crowd_budget', '人群预算建议');
  const table = assertPrimaryTable(payload, '人群预算建议', 1);
  assert.deepEqual(table.columns, ['人群分层', '指标', '订单成本', '人群花费占比', '花费']);
  assert.ok(table.rows.length <= 3);
  assert.equal(payload.rule_execution.originalCount, 4);
  assert.equal(payload.rule_execution.filteredCount, 3);
  assert.equal(payload.rule_execution.primaryMetric, 'order_cost');
  assert.ok(payload.highlights.length <= 2);
}

function testCrowdMixContract() {
  const payload = buildCase(
    'crowd_mix',
    'crowdMix',
    {
      label: '老客新客结构分析',
      dataScope: ['crowd'],
      strategy: {
        metrics: ['crowd_cost_share', 'order_cost'],
        primaryMetric: 'crowd_cost_share',
        comparisonLayers: ['老客', '新客', '兴趣新客'],
      },
      output: { topCount: 3 },
    },
    'crowd',
    crowdSummary,
  );

  assertBasicEnvelope(payload, 'crowd_mix', '老客新客结构分析');
  const table = assertPrimaryTable(payload, '老客新客结构分析', 1);
  assert.ok(table.columns.includes('人群分层'));
  assert.ok(table.columns.includes('人群花费占比'));
}

function testDailyDropReasonContract() {
  const payload = buildCase(
    'daily_drop_reason',
    'dailyDropReason',
    {
      label: '昨日花费波动归因',
      dataScope: ['crowd'],
      strategy: {
        metrics: ['ad_cost', 'gmv'],
        primaryMetric: 'ad_cost',
      },
      output: { topCount: 2 },
    },
    'crowd',
    crowdSummary,
  );

  assertBasicEnvelope(payload, 'daily_drop_reason', '昨日花费波动归因');
  const table = assertPrimaryTable(payload, '昨日花费波动归因', 1);
  assert.ok(table.rows.length <= 2);
}

function testWeakProductsContract() {
  const payload = buildCase(
    'weak_products',
    'weakProducts',
    {
      label: '高花费低回报商品诊断',
      dataScope: ['single'],
      strategy: {
        metrics: ['product_direct_roi', 'order_cost', 'ad_cost'],
        primaryMetric: 'product_direct_roi',
        secondaryMetric: 'order_cost',
        sort: ['primary_asc', 'secondary_desc', 'cost_desc'],
      },
      filters: { requirePositiveCost: true },
      output: { topCount: 3, highlightCount: 2 },
    },
    'single',
    products,
  );

  assertBasicEnvelope(payload, 'weak_products', '高花费低回报商品诊断');
  const table = assertPrimaryTable(payload, '高花费低回报商品诊断', 1);
  assert.ok(table.columns.includes('商品'));
  assert.ok(table.columns.includes('商品直接ROI'));
  assert.equal(table.rows[0]['商品'], '商品C');
}

function testProductPotentialContract() {
  const payload = buildCase(
    'product_potential',
    'productPotential',
    {
      label: '冲销售额商品识别',
      dataScope: ['single'],
      strategy: {
        metrics: ['product_direct_roi', 'product_direct_gmv', 'product_orders'],
        primaryMetric: 'product_direct_roi',
        secondaryMetric: 'product_direct_gmv',
        sort: ['roi_x_gmv_desc'],
      },
      filters: { requirePositiveOrders: true },
      output: { topCount: 3, highlightCount: 2 },
    },
    'single',
    products,
  );

  assertBasicEnvelope(payload, 'product_potential', '冲销售额商品识别');
  const table = assertPrimaryTable(payload, '冲销售额商品识别', 1);
  assert.equal(table.rows[0]['商品'], '商品B');
}

function testPeriodicReportContract() {
  const payload = buildCase(
    'weekly_report',
    'periodicReport',
    {
      label: '周报生成',
      dataScope: ['ads'],
      strategy: {
        metrics: ['breakeven_roi', 'ad_cost', 'gmv', 'orders'],
        primaryMetric: 'breakeven_roi',
      },
      output: { topCount: 1 },
    },
    'ads',
    [{ cost: 300000, breakevenRoi: 1.18, amount: 540000, orders: 1700 }],
  );

  assertBasicEnvelope(payload, 'weekly_report', '周报生成');
  const table = assertPrimaryTable(payload, '周报生成', 1);
  assert.ok(table.columns.includes('盈亏平衡ROI'));
  assert.ok(table.columns.includes('成交笔数'));
}

function testLossReasonContract() {
  const payload = buildCase(
    'loss_reason',
    'lossReason',
    {
      label: '亏损原因分析',
      dataScope: ['ads'],
      strategy: {
        metrics: ['breakeven_roi', 'ad_cost', 'gmv'],
        primaryMetric: 'breakeven_roi',
      },
      output: { topCount: 1 },
    },
    'ads',
    [{ cost: 300000, breakevenRoi: 0.82, amount: 540000, orders: 1700 }],
  );

  assertBasicEnvelope(payload, 'loss_reason', '亏损原因分析');
  assertPrimaryTable(payload, '亏损原因分析', 1);
}

function main() {
  testCrowdBudgetContract();
  testCrowdMixContract();
  testDailyDropReasonContract();
  testWeakProductsContract();
  testProductPotentialContract();
  testPeriodicReportContract();
  testLossReasonContract();

  console.log(
    `GenBI contract passed: ${JSON.stringify({
      checked: [
        'crowd_budget',
        'crowd_mix',
        'daily_drop_reason',
        'weak_products',
        'product_potential',
        'weekly_report',
        'loss_reason',
      ].length,
    })}`,
  );
}

main();
