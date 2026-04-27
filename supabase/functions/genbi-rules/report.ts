import { getDashboardPayload } from '../_shared/dashboard-payload.ts';
import type { GenbiRange } from '../_shared/genbi-time.ts';
import { buildAnswerEnvelope, composeTable, computeChangeRate, money, percent, ratio } from '../_shared/genbi-format.ts';
import { mapPayloadCrowdSummary, mapPayloadSingleItems } from '../_shared/genbi-payload-adapters.ts';
import { getLossReasonRuleConfig, getPeriodicReportRuleConfig } from '../_shared/genbi-rule-resolver.ts';

export function buildPeriodicReportResponse(
  kind: 'weekly_report' | 'monthly_report',
  range: GenbiRange,
  currentAds: { cost: number; breakevenRoi: number },
  previousAds: { cost: number; breakevenRoi: number },
  crowdSummary: any[],
  singleSummary: any[],
  options: { topCrowdCount: number; topProductCount: number },
) {
  const costChange = computeChangeRate(currentAds.cost, previousAds.cost);
  const roiChange = computeChangeRate(currentAds.breakevenRoi, previousAds.breakevenRoi);

  const answer = [
    `${range.label}核心结论：花费 ${money(currentAds.cost)}，盈亏平衡ROI ${ratio(currentAds.breakevenRoi)}。`,
    `相对上一周期，花费${costChange === null ? '无法计算环比' : `${costChange >= 0 ? '上升' : '下降'} ${percent(Math.abs(costChange))}` }，盈亏平衡ROI${roiChange === null ? '无法计算环比' : `${roiChange >= 0 ? '上升' : '下降'} ${percent(Math.abs(roiChange))}` }。`,
    crowdSummary[0] ? `当前花费最高的人群是 ${crowdSummary[0].layer}，订单成本 ${Number.isFinite(crowdSummary[0].orderCost) ? money(crowdSummary[0].orderCost) : '无成交'}。` : '',
    singleSummary[0] ? `当前单品成交贡献最高的商品是 ${singleSummary[0].productName}，商品直接成交金额 ${money(singleSummary[0].productAmount)}。` : '',
  ].filter(Boolean).join('');

  return buildAnswerEnvelope(
    kind,
    kind === 'weekly_report' ? '周报生成' : '月报生成',
    answer,
    range,
    [
      composeTable('核心指标对比', ['指标', '当前周期', '上一周期', kind === 'weekly_report' ? '周环比' : '月环比'], [
        {
          '指标': '花费',
          '当前周期': money(currentAds.cost),
          '上一周期': money(previousAds.cost),
          [kind === 'weekly_report' ? '周环比' : '月环比']: costChange === null ? '-' : percent(costChange),
        },
        {
          '指标': '盈亏平衡ROI',
          '当前周期': ratio(currentAds.breakevenRoi),
          '上一周期': ratio(previousAds.breakevenRoi),
          [kind === 'weekly_report' ? '周环比' : '月环比']: roiChange === null ? '-' : percent(roiChange),
        },
      ]),
      composeTable('重点人群', ['人群分层', '花费', '订单成本'], crowdSummary.slice(0, options.topCrowdCount).map((item) => ({
        '人群分层': item.layer,
        '花费': money(item.cost),
        '订单成本': Number.isFinite(item.orderCost) ? money(item.orderCost) : '-',
      }))),
      composeTable('重点商品', ['商品', '商品直接成交金额', '商品直接ROI'], singleSummary.map((item) => ({
        '商品': item.productName,
        '商品直接成交金额': money(item.productAmount),
        '商品直接ROI': ratio(item.productDirectRoi),
      }))),
    ],
  );
}

export async function answerPeriodicReport(kind: 'weekly_report' | 'monthly_report', range: GenbiRange) {
  const config = await getPeriodicReportRuleConfig();
  const [currentPayload, previousPayload] = await Promise.all([
    getDashboardPayload(range.start, range.end, config.dataScopeFlags),
    getDashboardPayload(range.compareStart || range.start, range.compareEnd || range.end, config.dataScopeFlags),
  ]);
  const currentAds = {
    cost: Number((currentPayload as any)?.ads?.kpi?.totalCost || 0),
    breakevenRoi: Number((currentPayload as any)?.ads?.kpi?.totalBreakevenRoi || 0),
  };
  const previousAds = {
    cost: Number((previousPayload as any)?.ads?.kpi?.totalCost || 0),
    breakevenRoi: Number((previousPayload as any)?.ads?.kpi?.totalBreakevenRoi || 0),
  };
  const crowdSummary = mapPayloadCrowdSummary((currentPayload as any)?.crowd?.summary);
  const singleSummary = mapPayloadSingleItems((currentPayload as any)?.single?.items).slice(0, config.topProductCount);
  return buildPeriodicReportResponse(kind, range, currentAds, previousAds, crowdSummary, singleSummary, {
    topCrowdCount: config.topCrowdCount,
    topProductCount: config.topProductCount,
  });
}

export function buildLossReasonResponse(
  range: GenbiRange,
  ads: { cost: number; breakevenRoi: number; amount: number },
  crowd: any[],
  products: any[],
) {
  const metrics = {
    cost: Number(ads.cost || 0),
    breakevenRoi: Number(ads.breakevenRoi || 0),
    amount: Number(ads.amount || 0),
  };
  const answer = `在 ${range.start} 至 ${range.end} 期间，整体盈亏平衡ROI 为 ${ratio(metrics.breakevenRoi)}。如果低于 1，主要亏损点通常落在高花费但订单成本偏高的人群和商品上。当前最需要优先检查的人群是 ${crowd.map((item) => `${item.layer}（订单成本 ${Number.isFinite(item.orderCost) ? money(item.orderCost) : '无成交'}）`).join('、')}；商品侧优先看 ${products.map((item) => `${item.productName}（商品订单成本 ${Number.isFinite(item.orderCost) ? money(item.orderCost) : '无成交'}）`).join('、')}。`;
  return buildAnswerEnvelope(
    'loss_reason',
    '亏损原因分析',
    answer,
    range,
    [
      composeTable('整体核心指标', ['指标', '数值'], [
        { '指标': '花费', '数值': money(metrics.cost) },
        { '指标': '盈亏平衡ROI', '数值': ratio(metrics.breakevenRoi) },
        { '指标': '总成交金额', '数值': money(metrics.amount) },
      ]),
    ],
  );
}

export async function answerLossReason(range: GenbiRange) {
  const config = await getLossReasonRuleConfig();
  const payload = await getDashboardPayload(range.start, range.end, config.dataScopeFlags) as any;
  const ads = {
    cost: Number(payload?.ads?.kpi?.totalCost || 0),
    breakevenRoi: Number(payload?.ads?.kpi?.totalBreakevenRoi || 0),
    amount: Number(payload?.ads?.kpi?.totalAmount || 0),
  };
  const crowd = mapPayloadCrowdSummary(payload?.crowd?.summary).sort((a, b) => b.orderCost - a.orderCost).slice(0, config.topCrowdCount);
  const products = mapPayloadSingleItems(payload?.single?.items).sort((a, b) => b.orderCost - a.orderCost).slice(0, config.topProductCount);
  return buildLossReasonResponse(range, ads, crowd, products);
}
