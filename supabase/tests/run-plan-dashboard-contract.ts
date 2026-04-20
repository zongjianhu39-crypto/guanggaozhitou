import assert from 'node:assert/strict';

import { buildPlanDashboardSummary } from '../functions/_shared/plan-dashboard-core.ts';

function assertNumber(value: unknown, label: string) {
  assert.equal(typeof value, 'number', `${label} should be number`);
  assert.ok(Number.isFinite(value), `${label} should be finite`);
}

function main() {
  const summary = buildPlanDashboardSummary({
    start: '2026-01-01',
    end: '2026-01-03',
    plans: [
      { plan_date: '2026-01-01', wanxiang_plan: '200', agent_plan: '50', remark: '首日计划' },
      { plan_date: '2026-01-02', wanxiang_plan: '100', agent_plan: '0', activity_override: '手动节奏' },
    ],
    activities: [
      {
        id: 'activity-1',
        activity_name: '新年活动',
        activity_type: 'spot_burst',
        start_date: '2026-01-01',
        end_date: '2026-01-03',
        description: '测试活动',
      },
    ],
    wanxiangRows: [
      { 日期: '2026-01-01', 花费: '260' },
      { 日期: '2026/01/02', 花费: '40' },
    ],
    agentRows: [
      { date: '2026-01-01', amount: '50' },
      { date: '2026-01-01', amount: '25' },
      { date: '2026-01-03', amount: '30' },
    ],
    referenceAgentRows: [
      { date: '2025-01-01', amount: '11' },
      { date: '2025-01-01', amount: '22' },
      { date: '2025-01-03', amount: '44' },
    ],
    shortLiveLinkRows: [
      { date: '2026-01-01', 花费: '15' },
    ],
    referenceRows: [
      { date: '2025-01-01', 花费: '80', 观看次数: '1000', 总成交笔数: '12', 总购物车数: '30', 总预售成交笔数: '3' },
      { date: '2025-01-02', 花费: '90', 观看次数: '800', 总成交笔数: '8', 总购物车数: '20', 总预售成交笔数: '2' },
    ],
    referenceFinancialRows: [
      { 日期: '2025/1/1', 保量佣金: '111', 预估结算机构佣金: '222', 品牌费: '333' },
      { 日期: '2025/1/2', 保量佣金: '444', 预估结算机构佣金: '555', 品牌费: '666' },
    ],
    referenceTaobaoLiveRows: [
      { 日期: '2025-01-01', 成交人数: '9', 成交笔数: '15' },
      { 日期: '2025-01-02', 成交人数: '6', 成交笔数: '10' },
    ],
  });

  assert.deepEqual(Object.keys(summary).sort(), ['activities', 'days', 'kpis', 'range']);
  assert.deepEqual(summary.range, { start: '2026-01-01', end: '2026-01-03' });
  assert.ok(Array.isArray(summary.days), 'days should be array');
  assert.ok(Array.isArray(summary.activities), 'activities should be array');
  assert.equal(summary.days.length, 3);
  assert.equal(summary.activities.length, 1);

  const kpis = summary.kpis as Record<string, unknown>;
  [
    'total_wanxiang_plan',
    'total_agent_plan',
    'total_plan_amount',
    'total_actual_cost',
    'overall_completion_rate',
  ].forEach((key) => assert.ok(key in kpis, `missing kpi: ${key}`));
  assertNumber(kpis.total_plan_amount, 'total_plan_amount');
  assertNumber(kpis.total_actual_cost, 'total_actual_cost');
  assertNumber(kpis.overall_completion_rate, 'overall_completion_rate');

  const firstDay = summary.days[0] as Record<string, unknown>;
  [
    'date',
    'wanxiang_plan',
    'agent_plan',
    'total_plan_amount',
    'activity',
    'activity_source',
    'actual_cost',
    'agent_amount',
    'completion_rate',
    'reference_amount',
    'reference_views',
    'reference_orders',
    'reference_cart',
    'reference_pre_orders',
    'reference_buyers',
    'reference_taobao_orders',
    'reference_financial_guarantee_commission',
    'reference_financial_estimated_agency_commission',
    'reference_financial_brand_fee',
    'remark',
  ].forEach((key) => assert.ok(key in firstDay, `missing day field: ${key}`));

  assert.equal(firstDay.date, '2026-01-01');
  assert.equal(firstDay.agent_amount, 33);
  assert.equal(firstDay.actual_cost, 350);
  assert.equal(firstDay.reference_amount, 80);
  assert.equal(firstDay.reference_views, 1000);
  assert.equal(firstDay.reference_orders, 12);
  assert.equal(firstDay.reference_cart, 30);
  assert.equal(firstDay.reference_pre_orders, 3);
  assert.equal(firstDay.reference_buyers, 9);
  assert.equal(firstDay.reference_taobao_orders, 15);
  assert.equal(firstDay.reference_financial_guarantee_commission, 111);
  assert.equal(firstDay.reference_financial_estimated_agency_commission, 222);
  assert.equal(firstDay.reference_financial_brand_fee, 333);
  assert.equal(firstDay.completion_rate, 350 / 250);
  assert.ok(Number(firstDay.completion_rate) > 1, 'completion rate should not be capped at 1');

  const secondDay = summary.days[1] as Record<string, unknown>;
  assert.equal(secondDay.agent_amount, null);
  assert.equal(secondDay.activity, '手动节奏');
  assert.equal(secondDay.activity_source, 'override');

  console.log(`Plan dashboard contract passed: ${JSON.stringify({ checked: summary.days.length })}`);
}

main();
