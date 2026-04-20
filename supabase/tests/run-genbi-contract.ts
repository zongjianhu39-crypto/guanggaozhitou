import assert from 'node:assert/strict';

import { buildCrowdBudgetResponse, buildCrowdMixResponse, buildDailyDropReasonResponse } from '../functions/genbi-rules/crowd.ts';
import { buildWeakProductsResponse, buildProductPotentialResponse } from '../functions/genbi-rules/product.ts';
import { buildPeriodicReportResponse, buildLossReasonResponse } from '../functions/genbi-rules/report.ts';

const range = {
  start: '2026-04-01',
  end: '2026-04-07',
  label: '2026-04-01 至 2026-04-07',
  compareStart: '2026-03-25',
  compareEnd: '2026-03-31',
};

const crowdSummary = [
  { layer: '老客', cost: 120000, amount: 460000, orders: 1200, costShare: 0, orderCost: 100, directNames: [] },
  { layer: '新客', cost: 90000, amount: 210000, orders: 500, costShare: 0, orderCost: 180, directNames: [] },
  { layer: '兴趣新客', cost: 70000, amount: 160000, orders: 410, costShare: 0, orderCost: 171, directNames: [] },
  { layer: '泛人群', cost: 30000, amount: 40000, orders: 80, costShare: 0, orderCost: 375, directNames: [] },
];

const previousCrowdSummary = [
  { layer: '老客', cost: 140000, amount: 480000, orders: 1300, costShare: 0, orderCost: 108, directNames: [] },
  { layer: '新客', cost: 110000, amount: 230000, orders: 520, costShare: 0, orderCost: 211, directNames: [] },
  { layer: '兴趣新客', cost: 60000, amount: 150000, orders: 390, costShare: 0, orderCost: 154, directNames: [] },
  { layer: '泛人群', cost: 50000, amount: 60000, orders: 100, costShare: 0, orderCost: 500, directNames: [] },
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
  assert.ok(payload.range && payload.range.start && payload.range.end);
  assert.ok(Array.isArray(payload.tables));
}

function assertTable(payload: any, title: string, minRows = 1) {
  const table = payload.tables.find((item: any) => item.title === title);
  assert.ok(table, `missing table: ${title}`);
  assert.ok(Array.isArray(table.columns) && table.columns.length > 0, `missing columns: ${title}`);
  assert.ok(Array.isArray(table.rows) && table.rows.length >= minRows, `missing rows: ${title}`);
}

function main() {
  const crowdBudget = buildCrowdBudgetResponse(range, crowdSummary.map((item) => ({ ...item })), {
    minCostShare: 0.05,
    topCount: 3,
    tableLimit: 10,
  });
  assertBasicEnvelope(crowdBudget, 'crowd_budget', '人群预算建议');
  assertTable(crowdBudget, '人群分层效率');
  assert.ok(Array.isArray(crowdBudget.highlights) && crowdBudget.highlights.length > 0);

  const crowdMix = buildCrowdMixResponse(range, crowdSummary.map((item) => ({ ...item })));
  assertBasicEnvelope(crowdMix, 'crowd_mix', '老客新客结构分析');
  assertTable(crowdMix, '人群结构占比');

  const dailyDrop = buildDailyDropReasonResponse(range, crowdSummary.map((item) => ({ ...item })), previousCrowdSummary.map((item) => ({ ...item })), {
    topDropCount: 3,
  });
  assertBasicEnvelope(dailyDrop, 'daily_drop_reason', '昨日花费波动归因');
  assertTable(dailyDrop, '人群花费变化');

  const weakProducts = buildWeakProductsResponse(range, products.map((item) => ({ ...item })), {
    minFocusPoolSize: 2,
    focusPoolCostCoverage: 0.85,
    topCount: 3,
    highlightCount: 2,
  });
  assertBasicEnvelope(weakProducts, 'weak_products', '高花费低回报商品诊断');
  assertTable(weakProducts, '单品广告高花费低回报商品');

  const productPotential = buildProductPotentialResponse(range, products.map((item) => ({ ...item })), {
    topCount: 3,
    highlightCount: 2,
  });
  assertBasicEnvelope(productPotential, 'product_potential', '冲销售额商品识别');
  assertTable(productPotential, '潜力商品');

  const weeklyReport = buildPeriodicReportResponse(
    'weekly_report',
    { ...range, label: '上周' },
    { cost: 300000, breakevenRoi: 1.18 },
    { cost: 260000, breakevenRoi: 1.03 },
    crowdSummary.map((item) => ({ ...item })),
    products.map((item) => ({ ...item })),
    { topCrowdCount: 3, topProductCount: 3 },
  );
  assertBasicEnvelope(weeklyReport, 'weekly_report', '周报生成');
  assertTable(weeklyReport, '核心指标对比');
  assertTable(weeklyReport, '重点人群');
  assertTable(weeklyReport, '重点商品');

  const lossReason = buildLossReasonResponse(
    range,
    { cost: 300000, breakevenRoi: 0.82, amount: 540000 },
    crowdSummary.map((item) => ({ ...item })),
    products.map((item) => ({ ...item })),
  );
  assertBasicEnvelope(lossReason, 'loss_reason', '亏损原因分析');
  assertTable(lossReason, '整体核心指标');

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
