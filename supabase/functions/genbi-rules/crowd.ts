import { getDashboardPayload } from '../_shared/dashboard-payload.ts';
import type { GenbiRange } from '../_shared/genbi-time.ts';
import { buildAnswerEnvelope, composeTable, money, percent } from '../_shared/genbi-format.ts';
import { mapPayloadCrowdSummary } from '../_shared/genbi-payload-adapters.ts';
import { getCrowdBudgetRuleConfig, getCrowdMixRuleConfig, getDailyDropReasonRuleConfig } from '../_shared/genbi-rule-resolver.ts';

export function buildCrowdBudgetResponse(range: GenbiRange, summary: any[], options: { minCostShare: number; topIncreaseCount: number; topDecreaseCount: number; tableLimit: number }) {
  const totalCost = summary.reduce((sum, item) => sum + item.cost, 0);
  summary.forEach((item) => {
    item.costShare = totalCost > 0 ? item.cost / totalCost : 0;
  });
  const increase = summary
    .filter((item) => Number.isFinite(item.orderCost) && item.costShare >= options.minCostShare)
    .sort((a, b) => a.orderCost - b.orderCost)
    .slice(0, options.topIncreaseCount);
  const decrease = summary
    .filter((item) => Number.isFinite(item.orderCost) && item.costShare >= options.minCostShare)
    .sort((a, b) => b.orderCost - a.orderCost)
    .slice(0, options.topDecreaseCount);

  const answer = [
    `分析范围是 ${range.start} 至 ${range.end}。`,
    '当前按人群分层没有直接的盈亏平衡ROI，我按你确认的口径使用“订单成本”判断效率。',
    increase.length
      ? `更适合加预算的是 ${increase.map((item) => `${item.layer}（订单成本 ${money(item.orderCost)}，花费占比 ${percent(item.costShare)}）`).join('、')}。`
      : '当前没有筛出明确适合直接加预算的人群。',
    decrease.length
      ? `更需要压预算的是 ${decrease.map((item) => `${item.layer}（订单成本 ${money(item.orderCost)}，花费占比 ${percent(item.costShare)}）`).join('、')}。`
      : '当前没有筛出明确需要直接压预算的人群。',
  ].join('');

  return buildAnswerEnvelope(
    'crowd_budget',
    '人群预算建议',
    answer,
    range,
    [
      composeTable(
        '人群分层效率',
        ['人群分层', '花费', '花费占比', '订单成本', '成交金额', '成交笔数'],
        summary.slice(0, options.tableLimit).map((item) => ({
          '人群分层': item.layer,
          '花费': money(item.cost),
          '花费占比': percent(item.costShare),
          '订单成本': Number.isFinite(item.orderCost) ? money(item.orderCost) : '-',
          '成交金额': money(item.amount),
          '成交笔数': item.orders,
        })),
      ),
    ],
    increase.map((item) => `建议加预算：${item.layer}`),
    ['当前策略基于订单成本，不是基于盈亏平衡ROI。'],
  );
}

export async function answerCrowdBudget(range: GenbiRange) {
  const config = await getCrowdBudgetRuleConfig();
  const payload = await getDashboardPayload(range.start, range.end, config.dataScopeFlags) as any;
  const excluded = new Set(config.excludeLayers);
  const summary = mapPayloadCrowdSummary(payload?.crowd?.summary).filter((item) => !excluded.has(item.layer));
  return buildCrowdBudgetResponse(range, summary, {
    minCostShare: config.minCostShare,
    topIncreaseCount: config.topIncreaseCount,
    topDecreaseCount: config.topDecreaseCount,
    tableLimit: config.tableLimit,
  });
}

export function buildCrowdMixResponse(range: GenbiRange, summary: any[]) {
  const totalCost = summary.reduce((sum, item) => sum + item.cost, 0);
  const oldCost = summary.filter((item) => item.layer === '老客').reduce((sum, item) => sum + item.cost, 0);
  const newCost = summary.filter((item) => item.layer === '新客').reduce((sum, item) => sum + item.cost, 0);
  const interestCost = summary.filter((item) => item.layer === '兴趣新客').reduce((sum, item) => sum + item.cost, 0);
  const answer = `分析范围是 ${range.start} 至 ${range.end}。老客花费占比 ${percent(totalCost > 0 ? oldCost / totalCost : 0)}，新客花费占比 ${percent(totalCost > 0 ? newCost / totalCost : 0)}，兴趣新客花费占比 ${percent(totalCost > 0 ? interestCost / totalCost : 0)}。如果当前目标是利润，老客和兴趣新客占比应更高；如果当前目标是拉新，新客占比偏高可以接受。`;
  return buildAnswerEnvelope(
    'crowd_mix',
    '老客新客结构分析',
    answer,
    range,
    [
      composeTable(
        '人群结构占比',
        ['人群分层', '花费', '花费占比', '订单成本'],
        summary.map((item) => ({
          '人群分层': item.layer,
          '花费': money(item.cost),
          '花费占比': percent(totalCost > 0 ? item.cost / totalCost : 0),
          '订单成本': Number.isFinite(item.orderCost) ? money(item.orderCost) : '-',
        })),
      ),
    ],
  );
}

export async function answerCrowdMix(range: GenbiRange) {
  const config = await getCrowdMixRuleConfig();
  const payload = await getDashboardPayload(range.start, range.end, config.dataScopeFlags) as any;
  const summary = mapPayloadCrowdSummary(payload?.crowd?.summary);
  return buildCrowdMixResponse(range, summary);
}

export function buildDailyDropReasonResponse(range: GenbiRange, currentCrowd: any[], previousCrowd: any[], options: { topDropCount: number }) {
  const currentCost = currentCrowd.reduce((sum, item) => sum + item.cost, 0);
  const previousCost = previousCrowd.reduce((sum, item) => sum + item.cost, 0);
  const deltas = currentCrowd.map((item) => {
    const prev = previousCrowd.find((candidate) => candidate.layer === item.layer);
    return {
      layer: item.layer,
      delta: item.cost - (prev?.cost || 0),
      currentCost: item.cost,
      previousCost: prev?.cost || 0,
    };
  }).sort((a, b) => a.delta - b.delta);

  const topDrop = deltas.slice(0, options.topDropCount).filter((item) => item.delta < 0);
  const answer = `昨日花费 ${money(currentCost)}，前一日花费 ${money(previousCost)}，变化 ${money(currentCost - previousCost)}。下滑主要来自 ${topDrop.map((item) => `${item.layer}（减少 ${money(Math.abs(item.delta))}）`).join('、') || '当前没有明显单一人群变化'}。`;
  return buildAnswerEnvelope(
    'daily_drop_reason',
    '昨日花费波动归因',
    answer,
    range,
    [composeTable('人群花费变化', ['人群分层', '昨日花费', '前一日花费', '变化额'], deltas.map((item) => ({
      '人群分层': item.layer,
      '昨日花费': money(item.currentCost),
      '前一日花费': money(item.previousCost),
      '变化额': item.delta >= 0 ? `+${money(item.delta)}` : `-${money(Math.abs(item.delta))}`,
    })))],
  );
}

export async function answerDailyDropReason(range: GenbiRange) {
  const config = await getDailyDropReasonRuleConfig();
  const [todayPayload, comparePayload] = await Promise.all([
    getDashboardPayload(range.start, range.end, config.dataScopeFlags),
    getDashboardPayload(range.compareStart || range.start, range.compareEnd || range.end, config.dataScopeFlags),
  ]);
  const currentCrowd = mapPayloadCrowdSummary((todayPayload as any)?.crowd?.summary);
  const previousCrowd = mapPayloadCrowdSummary((comparePayload as any)?.crowd?.summary);
  return buildDailyDropReasonResponse(range, currentCrowd, previousCrowd, {
    topDropCount: config.topDropCount,
  });
}
