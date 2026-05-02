/**
 * AI 数据分析 Edge Function
 * 聚合筛选范围内数据，调用 MiniMax AI 生成分析报告
 */

import { buildPrompt, BUILTIN_INSTRUCTIONS, type AnalysisData } from './prompt-templates.ts';
import { requirePromptAdminToken } from '../_shared/prompt-admin-auth.ts';
import { resolveActivePromptTemplate, type ActivePromptTemplate } from '../_shared/prompt-store.ts';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { getDashboardPayload } from '../_shared/dashboard-payload.ts';
import { createErrorResponse } from '../_shared/error-handler.ts';
import { validatePromptInput, sanitizePromptInput, validateDateString } from '../_shared/input-validator.ts';
import { checkRateLimit, createRateLimitResponse } from '../_shared/rate-limiter.ts';
import { callMiniMax } from '../_shared/minimax-client.ts';
import { debugLog } from '../_shared/logger.ts';
import { getSupabaseHeaders, SB_URL, SB_SERVICE_ROLE_KEY, checkDailyRunLimitForUser } from './supabase-rest.ts';
import { insertAiReportRun, upsertAiReport } from './report-store.ts';
import { getAnalysisSectionTitles, sanitizeAnalysisOutput, extractHeadlineFromAnalysis } from './analysis-text.ts';
import { buildReportFromDashboardPayload } from './dashboard-report.ts';
import {
  accumulateMetrics,
  buildActions,
  buildCostStructureSummary,
  buildFallbackHeadline,
  buildHighSpendCrowdSummary,
  buildLiveSessionSummary,
  buildReportSlug,
  buildReportTitle,
  buildRiskLevel,
  buildSingleFallbackHeadline,
  buildSingleRiskLevel,
  buildTags,
  buildTomorrowFocus,
  classifyCrowd,
  createMetricBucket,
  pickOverallJudgement,
  rankCostStructure,
  rankHighSpendCrowds,
  rankKeySegments,
  rankLiveSessions,
  rankSingleProducts,
  summarizeBestSingleProducts,
  summarizeCartOpportunities,
  summarizeCostStructure,
  summarizeHighSpendCrowds,
  summarizeKeySegments,
  summarizeLiveSessions,
  summarizeSingleProducts,
  summarizeWeakSingleProducts,
  toNum,
  uniqueStrings,
} from './report-metrics.ts';
import {
  AI_FINANCIAL_COLUMNS,
  AI_SUPER_LIVE_COLUMNS,
  AI_TAOBAO_LIVE_COLUMNS,
  fetchRoutedTables,
  filterByDateRange,
} from './data-fetch.ts';
import type {
  ActionPriority,
  BudgetDecision,
  CostStructureItem,
  CrowdInsight,
  DailyReportResult,
  DashboardPayloadLike,
  DataRow,
  LiveSessionItem,
  MetricBucket,
  OverallJudgement,
  ProductInsight,
  ReportAction,
  ReportIssue,
  RiskLevel,
  SegmentInsight,
  StructuredReportPayload,
} from './analysis-types.ts';
import {
  getFinancialTablesForDateRange,
  getSingleProductAdTablesForDateRange,
  getSuperLiveTablesForDateRange,
  getTaobaoLiveTablesForDateRange
} from '../_shared/table-routes.ts';

// ============ 环境变量 =============
const REPORT_SCHEMA_VERSION = 'v2-high-spend-ops';

const AI_DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '10');

async function authenticateRequest(req: Request) {
  return authenticateEdgeRequest(req, {
    allowPromptAdmin: true,
    allowSupabaseUser: true,
  });
}

// ============ CORS =============
const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
const EXTRA_ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowedOrigins = new Set([PROD_ORIGIN, 'https://www.friends.wang', 'https://friends.wang', ...EXTRA_ALLOWED_ORIGINS]);
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ? origin
    : origin === 'null'
      ? 'null'
      : allowedOrigins.has(origin)
        ? origin
        : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function getErrorStatus(error: Error): number {
  if (error.message.includes('无效或已过期的 Prompt 管理令牌')) {
    return 401;
  }
  return 500;
}

async function resolvePromptRuntimeTemplate(input: {
  templateKey: string;
  promptOverride?: string | null;
  promptAdminToken?: string | null;
}): Promise<ActivePromptTemplate> {
  const overrideContent = sanitizePromptInput(String(input.promptOverride ?? ''));
  if (overrideContent) {
    await requirePromptAdminToken(String(input.promptAdminToken ?? ''));
    return {
      templateKey: input.templateKey,
      versionId: null,
      versionLabel: 'draft-preview',
      content: overrideContent,
      source: 'override',
    };
  }

  const resolved = await resolveActivePromptTemplate(input.templateKey);
  if (resolved.source === 'database' && resolved.content.trim()) {
    return resolved;
  }
  // DB 无内容则用内置默认指令
  const fallback = BUILTIN_INSTRUCTIONS[input.templateKey] ?? BUILTIN_INSTRUCTIONS.daily;
  return { templateKey: input.templateKey, versionId: null, versionLabel: 'builtin-fallback', content: fallback, source: 'fallback' };
}

// ============ 工具函数 =============

/** 解析 YYYY-MM-DD，返回上一天的 YYYY-MM-DD */
function yesterday(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ============ 数据查询 =============

/** 聚合超级直播核心指标 */
async function getDailyReport(
  startDate: string,
  endDate: string,
  analysisType: string
): Promise<DailyReportResult | null> {
  const superLiveTables = getSuperLiveTablesForDateRange(startDate, endDate);
  debugLog(`[ai-analysis] 查询日期范围: ${startDate} ~ ${endDate}, 超级直播表: ${JSON.stringify(superLiveTables.map((item) => item.table))}`);
  debugLog(
    `[ai-analysis] env check: SUPABASE_URL=${!!SB_URL}, SERVICE_ROLE_KEY=${!!SB_SERVICE_ROLE_KEY}`
  );

  // 并行加载 super_live_* 表，所有底表统一使用 日期 + gte/lte 范围过滤。
  const superLiveFlat = await fetchRoutedTables(superLiveTables, AI_SUPER_LIVE_COLUMNS);
  debugLog(`[ai-analysis] super_live 总行数: ${superLiveFlat.length}, 前3行: ${JSON.stringify(superLiveFlat.slice(0,3))}`);
  const superLiveData = filterByDateRange(superLiveFlat, startDate, endDate);
  debugLog(`[ai-analysis] super_live 过滤后行数: ${superLiveData.length}`);

  // 并行加载 financial 和 taobao_live
  const financialPromise = fetchRoutedTables(getFinancialTablesForDateRange(startDate, endDate), AI_FINANCIAL_COLUMNS);
  const taobaoPromise = fetchRoutedTables(getTaobaoLiveTablesForDateRange(startDate, endDate), AI_TAOBAO_LIVE_COLUMNS);

  const [financialRaw, taobaoRaw] = await Promise.all([financialPromise, taobaoPromise]);
  const financialData = filterByDateRange(financialRaw, startDate, endDate);
  const taobaoData = filterByDateRange(taobaoRaw, startDate, endDate);
  debugLog(`[ai-analysis] financial 过滤后: ${financialData.length}, taobao_live 过滤后: ${taobaoData.length}`);

  // 空数据拦截
  if (superLiveData.length === 0 && financialData.length === 0 && taobaoData.length === 0) {
    debugLog(`[ai-analysis] 空数据拦截`);
    return null;
  }

  // ===== 聚合超级直播核心指标 =====
  let totalCost = 0,
    totalAmount = 0,
    totalOrders = 0,
    totalViews = 0,
    totalShows = 0,
    totalDirectAmount = 0,
    totalCart = 0,
    totalPreOrders = 0,
    totalInteractions = 0;

  const crowdCategoryMap = new Map<string, MetricBucket>();
  const crowdNameMap = new Map<string, { category: string; bucket: MetricBucket }>();

  for (const r of superLiveData) {
    totalCost += toNum(r['花费']);
    totalAmount += toNum(r['总成交金额']);
    totalOrders += toNum(r['总成交笔数']);
    totalViews += toNum(r['观看次数']);
    totalShows += toNum(r['展现量']);
    totalDirectAmount += toNum(r['直接成交金额']);
    totalCart += toNum(r['总购物车数']);
    totalPreOrders += toNum(r['总预售成交笔数']);
    totalInteractions += toNum(r['互动量']);

    const crowdName = String(r['人群名字'] ?? '').trim() || '未命名人群';
    const crowdCategory = classifyCrowd(crowdName);

    const categoryBucket = crowdCategoryMap.get(crowdCategory) ?? createMetricBucket();
    accumulateMetrics(categoryBucket, r);
    crowdCategoryMap.set(crowdCategory, categoryBucket);

    const crowdDetail = crowdNameMap.get(crowdName) ?? {
      category: crowdCategory,
      bucket: createMetricBucket(),
    };
    crowdDetail.category = crowdCategory;
    accumulateMetrics(crowdDetail.bucket, r);
    crowdNameMap.set(crowdName, crowdDetail);
  }

  // ===== 聚合财务数据 =====
  let finRevenue = 0,
    finCost = 0,
    finProfitRaw = 0,
    finGuarantee = 0,
    finOffline = 0,
    finAgency = 0,
    finRedPacket = 0,
    finYanxuanRed = 0;

  const costBreakdown = new Map<string, number>();

  for (const r of financialData) {
    finRevenue += toNum(r['业务口径收入'] ?? r['支付gmv']);
    finCost += toNum(r['成本合计']);
    finProfitRaw += toNum(r['毛利']);
    finGuarantee += toNum(r['保量佣金']);
    finOffline += toNum(r['预估结算线下佣金']);
    finAgency += toNum(r['预估结算机构佣金']);
    finRedPacket += toNum(r['直播间红包']);
    finYanxuanRed += toNum(r['严选红包']);

    for (const key of [
      '流量投放',
      '保量佣金',
      '预估结算线下佣金',
      '预估结算机构佣金',
      '宣传费用',
      '现场费用',
      '抽奖及打赏',
      '物品补贴',
      '艺人成本',
      '内部主播成本',
      '直播间红包',
      '严选红包',
    ]) {
      costBreakdown.set(key, (costBreakdown.get(key) ?? 0) + toNum(r[key]));
    }
  }

  // ===== 聚合淘宝直播 =====
  let taobaoOrders = 0,
    taobaoViews = 0,
    taobaoGMV = 0,
    taobaoRefundAmount = 0;
  for (const r of taobaoData) {
    taobaoOrders += toNum(r['成交笔数']);
    taobaoViews += toNum(r['观看人数']);
    taobaoGMV += toNum(r['成交金额']);
    taobaoRefundAmount += toNum(r['退款金额']);
  }

  // ===== 计算衍生指标 =====
  const roi = totalCost > 0 ? totalAmount / totalCost : 0;
  const directRoi = totalCost > 0 ? totalDirectAmount / totalCost : 0;
  const viewCost = totalViews > 0 ? totalCost / totalViews : 0;
  const orderCost = totalOrders > 0 ? totalCost / totalOrders : 0;
  const cartCost = totalCart > 0 ? totalCost / totalCart : 0;
  const preOrderCost = totalPreOrders > 0 ? totalCost / totalPreOrders : 0;
  const viewRate = totalShows > 0 ? (totalViews / totalShows) * 100 : 0;
  const viewConvertRate = totalViews > 0 ? (totalOrders / totalViews) * 100 : 0;
  const deepInteractRate = totalViews > 0 ? (totalInteractions / totalViews) * 100 : 0;
  const cpm = totalShows > 0 ? (totalCost / totalShows) * 1000 : 0;
  const adOrderRatio = taobaoOrders > 0 ? (totalOrders / taobaoOrders) * 100 : 0;

  const finNet = finGuarantee + finOffline + finAgency - finRedPacket - finYanxuanRed;
  const breakevenRoi =
    totalCost > 0 && taobaoOrders > 0 ? (finNet * (totalOrders / taobaoOrders)) / totalCost : 0;
  const returnRate = taobaoGMV > 0 ? (taobaoRefundAmount / taobaoGMV) * 100 : 0;
  const returnRoi = totalCost > 0 ? (totalAmount * (1 - returnRate / 100)) / totalCost : 0;
  const finProfit = Math.abs(finProfitRaw) > 0 ? finProfitRaw : finRevenue - finCost;
  const finMargin = finRevenue > 0 ? (finProfit / finRevenue) * 100 : 0;

  const highSpendCrowds = rankHighSpendCrowds(crowdCategoryMap, totalCost, roi);
  const keySegments = rankKeySegments(crowdNameMap, totalCost, roi);
  const costStructure = rankCostStructure([...costBreakdown.entries()], finCost);
  const liveSessions = rankLiveSessions(taobaoData);
  const highSpendCrowdSummary = summarizeHighSpendCrowds(highSpendCrowds);
  const highSpendCrowdNames = summarizeKeySegments(keySegments);
  const costStructureSummary = summarizeCostStructure(costStructure);
  const liveSessionSummary = summarizeLiveSessions(liveSessions);

  // ===== 同比数据（昨日）=====
  const yStart = yesterday(startDate);
  const yEnd = yesterday(endDate);
  const ySuperLiveTables = getSuperLiveTablesForDateRange(yStart, yEnd);
  const ySuperLiveRaw = await fetchRoutedTables(ySuperLiveTables, AI_SUPER_LIVE_COLUMNS);
  const ySuperLive = filterByDateRange(ySuperLiveRaw, yStart, yEnd);
  const yTotalCost = ySuperLive.reduce((s, r) => s + toNum(r['花费']), 0);
  const yTotalAmount = ySuperLive.reduce((s, r) => s + toNum(r['总成交金额']), 0);
  const yRoi = yTotalCost > 0 ? yTotalAmount / yTotalCost : 0;

  const yoyCostDelta = totalCost > 0 && yTotalCost > 0 ? ((totalCost - yTotalCost) / yTotalCost) * 100 : null;
  const yoyAmountDelta = totalAmount > 0 && yTotalAmount > 0 ? ((totalAmount - yTotalAmount) / yTotalAmount) * 100 : null;
  const yoyRoiDelta = roi > 0 && yRoi > 0 ? ((roi - yRoi) / yRoi) * 100 : null;
  const riskLevel = buildRiskLevel({ roi, returnRoi, finMargin, returnRate, yoyRoiDelta });
  const overallJudgement = pickOverallJudgement(riskLevel);
  const worstCrowd = highSpendCrowds.find((item) => item.decision === 'reduce') ?? highSpendCrowds[0];
  const bestCrowd = highSpendCrowds.find((item) => item.decision === 'increase') ?? highSpendCrowds[0];
  const worstSegment = keySegments.find((item) => item.decision === 'reduce') ?? keySegments[0];
  const bestSegment = keySegments.find((item) => item.decision === 'increase') ?? keySegments[0];
  const issues = buildIssues({
    worstCrowd,
    bestCrowd,
    returnRate,
    finMargin,
    liveSessions,
    viewConvertRate,
  });
  const actions = buildActions({
    worstCrowd,
    bestCrowd,
    worstSegment,
    bestSegment,
    returnRate,
    finMargin,
    topCostItem: costStructure[0],
    topSession: liveSessions[0],
  });
  const tomorrowFocus = buildTomorrowFocus({
    worstCrowd,
    returnRate,
    finMargin,
    topSession: liveSessions[0],
  });
  const tags = buildTags({
    riskLevel,
    highSpendCrowds,
    returnRate,
    finMargin,
    topSession: liveSessions[0],
  });
  const reportTitle = buildReportTitle(analysisType, startDate, endDate);
  const reportSummary = buildFallbackHeadline(riskLevel, worstCrowd, bestCrowd, returnRate, finMargin);

  const promptData: AnalysisData = {
    dateRange: `${startDate} ~ ${endDate}`,
    fullDataContext: '（底表回退路径，暂无完整数据上下文）',
  };

  const structuredData: StructuredReportPayload = {
    meta: {
      reportType: analysisType,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      version: REPORT_SCHEMA_VERSION,
    },
    executiveSummary: {
      headline: reportSummary,
      overallJudgement,
      riskLevel,
    },
    overviewMetrics: {
      totalCost: totalCost.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      totalOrders: Math.round(totalOrders).toString(),
      roi: roi.toFixed(3),
      returnRoi: returnRoi.toFixed(3),
      finMargin: finMargin.toFixed(2) + '%',
      returnRate: returnRate.toFixed(2) + '%',
      yoyRoi: yoyRoiDelta !== null ? `${yoyRoiDelta.toFixed(1)}%` : 'N/A',
    },
    highSpendCrowds,
    keySegments,
    financeAdjustment: {
      summary:
        returnRate >= 8
          ? `退款与佣金正在侵蚀真实回报，当前退货率 ${toPercent(returnRate)}，毛利率 ${toPercent(finMargin)}。`
          : `财务压力可控，当前毛利率 ${toPercent(finMargin)}，重点仍需关注成本结构与利润修正。`,
      costStructure,
      finMargin: finMargin.toFixed(2) + '%',
      returnRate: returnRate.toFixed(2) + '%',
    },
    liveSessionInsight: {
      summary:
        liveSessions[0]
          ? `${liveSessions[0].name} 是当前重点场次，成交 ¥${liveSessions[0].amount.toFixed(0)}，退款率 ${liveSessions[0].refundRate.toFixed(2)}%。`
          : '暂无直播场次数据。',
      sessions: liveSessions,
    },
    issues,
    actions,
    tomorrowFocus,
    tags,
  };

  const inputSnapshot = {
    reportTitle,
    dateRange: promptData.dateRange,
    sourceMetrics: structuredData.overviewMetrics,
    highSpendCrowds,
    keySegments,
    costStructure,
    liveSessions,
  };

  return {
    promptData,
    structuredData,
    inputSnapshot,
    reportTitle,
    reportSummary,
    riskLevel,
    tags,
  };
}

async function fetchSingleProductRows(startDate: string, endDate: string): Promise<DataRow[]> {
  const allRows: DataRow[] = [];
  const batchSize = 1000;

  for (const { table } of getSingleProductAdTablesForDateRange(startDate, endDate)) {
    let offset = 0;
    for (;;) {
      const url = new URL(`${SB_URL}/rest/v1/${table}`);
      url.searchParams.set('select', '日期,商品id,商品名称,img_url,花费,直接成交笔数,直接成交金额,该商品直接成交笔数,该商品直接成交金额,该商品加购数,该商品收藏数,观看人数');
      url.searchParams.append('日期', `gte.${startDate}`);
      url.searchParams.append('日期', `lte.${endDate}`);
      url.searchParams.set('limit', String(batchSize));
      url.searchParams.set('offset', String(offset));

      const resp = await fetch(url.toString(), {
        headers: getSupabaseHeaders(),
      });
      const text = await resp.text();
      if (!resp.ok) {
        if (resp.status === 404) {
          console.warn(`[ai-analysis] 表 ${table} 不存在，按空表处理。`);
          break;
        }
        throw new Error(`查询表 ${table} 失败: ${resp.status} ${text}`);
      }
      const rows = text ? JSON.parse(text) : [];
      if (!Array.isArray(rows)) {
        throw new Error(`${table} 返回数据格式错误`);
      }
      allRows.push(...rows);
      if (rows.length < batchSize) {
        break;
      }
      offset += batchSize;
    }
  }

  return allRows;
}

async function getSingleProductReport(startDate: string, endDate: string): Promise<DailyReportResult | null> {
  const rows = await fetchSingleProductRows(startDate, endDate);
  if (!rows.length) {
    return null;
  }

  const rankedProducts = rankSingleProducts(rows, rows.reduce((sum, row) => sum + toNum(row['花费']), 0), 0);
  if (!rankedProducts.length) {
    return null;
  }

  const totalCost = rankedProducts.reduce((sum, item) => sum + item.cost, 0);
  const totalAmount = rankedProducts.reduce((sum, item) => sum + item.amount, 0);
  const totalOrders = rankedProducts.reduce((sum, item) => sum + item.orders, 0);
  const totalCarts = rankedProducts.reduce((sum, item) => sum + item.carts, 0);
  const totalViews = rankedProducts.reduce((sum, item) => sum + item.views, 0);
  const roi = totalCost > 0 ? totalAmount / totalCost : 0;
  const viewCost = totalViews > 0 ? totalCost / totalViews : 0;
  const orderCost = totalOrders > 0 ? totalCost / totalOrders : 0;
  const cartCost = totalCarts > 0 ? totalCost / totalCarts : 0;
  const zeroOrderCost = rankedProducts
    .filter((item) => item.orders === 0)
    .reduce((sum, item) => sum + item.cost, 0);
  const zeroOrderCostShare = totalCost > 0 ? (zeroOrderCost / totalCost) * 100 : 0;
  const riskLevel = buildSingleRiskLevel(roi, zeroOrderCostShare);
  const overallJudgement = pickOverallJudgement(riskLevel);
  const topProducts = rankedProducts.slice(0, 3);
  const bestProducts = [...rankedProducts]
    .filter((item) => item.cost >= 1000 || item.orders > 0)
    .sort((left, right) => right.roi - left.roi || right.amount - left.amount)
    .slice(0, 3);
  const weakProducts = [...rankedProducts]
    .filter((item) => item.orders === 0 || item.roi < Math.max(1, roi * 0.7))
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 3);
  const cartOpportunityProducts = [...rankedProducts]
    .filter((item) => item.views > 0 || item.carts > 0)
    .sort((left, right) => (right.carts - left.carts) || (right.views - left.views))
    .slice(0, 3);

  const promptData: AnalysisData = {
    dateRange: `${startDate} ~ ${endDate}`,
    fullDataContext: buildFullDataContext({}, rankedProducts),
  };

  const issues: ReportIssue[] = [];
  if (topProducts[0] && topProducts[0].roi < Math.max(1, roi * 0.8)) {
    issues.push({
      title: `${topProducts[0].name} 高消耗但效率偏低`,
      severity: riskLevel === 'critical' ? 'critical' : 'high',
      evidence: `花费占比 ${topProducts[0].costShare.toFixed(1)}%，商品ROI ${topProducts[0].roi.toFixed(2)}`,
      impact: '会直接拖累单品广告整体回报',
    });
  }
  if (zeroOrderCostShare >= 15) {
    issues.push({
      title: '零成交商品占用预算',
      severity: zeroOrderCostShare >= 30 ? 'high' : 'medium',
      evidence: `零成交商品花费占比 ${zeroOrderCostShare.toFixed(1)}%`,
      impact: '预算沉没，影响整体投放效率',
    });
  }
  if (cartOpportunityProducts[0] && cartOpportunityProducts[0].carts > cartOpportunityProducts[0].orders) {
    issues.push({
      title: `${cartOpportunityProducts[0].name} 有加购承接机会`,
      severity: 'low',
      evidence: `加购 ${Math.round(cartOpportunityProducts[0].carts)}，成交 ${Math.round(cartOpportunityProducts[0].orders)}`,
      impact: '可通过素材或承接页优化提升转化',
    });
  }

  const actions: ReportAction[] = [];
  if (weakProducts[0]) {
    actions.push({
      title: `收缩 ${weakProducts[0].name} 预算`,
      target: weakProducts[0].name,
      reason: `商品ROI ${weakProducts[0].roi.toFixed(2)}，高消耗但产出偏弱`,
      priority: 'p0',
    });
  }
  if (bestProducts[0]) {
    actions.push({
      title: `优先放量 ${bestProducts[0].name}`,
      target: bestProducts[0].name,
      reason: `商品ROI ${bestProducts[0].roi.toFixed(2)}，效率优于其他单品`,
      priority: 'p1',
    });
  }
  if (cartOpportunityProducts[0]) {
    actions.push({
      title: `优化 ${cartOpportunityProducts[0].name} 承接`,
      target: cartOpportunityProducts[0].name,
      reason: '有观看和加购基础，适合继续提升转化',
      priority: 'p1',
    });
  }

  const reportTitle = buildReportTitle('single', startDate, endDate);
  const reportSummary = buildSingleFallbackHeadline(riskLevel, topProducts[0], bestProducts[0]);
  const tags = uniqueStrings([
    '单品广告',
    bestProducts.length ? '高效单品' : '',
    weakProducts.length ? '低效单品' : '',
    cartOpportunityProducts.length ? '加购机会' : '',
    riskLevel === 'high' || riskLevel === 'critical' ? '高风险' : '',
  ]);

  const structuredData: StructuredReportPayload = {
    meta: {
      reportType: 'single',
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
      version: REPORT_SCHEMA_VERSION,
    },
    executiveSummary: {
      headline: reportSummary,
      overallJudgement,
      riskLevel,
    },
    overviewMetrics: {
      totalCost: totalCost.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      totalOrders: Math.round(totalOrders).toString(),
      roi: roi.toFixed(3),
      productCount: String(rankedProducts.length),
      totalCart: Math.round(totalCarts).toString(),
      viewCost: viewCost.toFixed(4),
      orderCost: orderCost.toFixed(2),
    },
    highSpendCrowds: [],
    keySegments: [],
    financeAdjustment: {
      summary: '单品广告分析暂未接入财务修正数据，请结合整体看板交叉判断。',
      costStructure: [],
      finMargin: '数据不足',
      returnRate: '数据不足',
    },
    liveSessionInsight: {
      summary: summarizeCartOpportunities(cartOpportunityProducts),
      sessions: [],
    },
    issues,
    actions,
    tomorrowFocus: uniqueStrings([
      '单品整体ROI',
      weakProducts[0]?.name ? `${weakProducts[0].name} ROI` : '',
      bestProducts[0]?.name ? `${bestProducts[0].name} ROI` : '',
      cartOpportunityProducts[0]?.name ? `${cartOpportunityProducts[0].name} 转化率` : '',
    ]).slice(0, 5),
    tags,
  };

  const inputSnapshot = {
    reportTitle,
    dateRange: promptData.dateRange,
    sourceMetrics: structuredData.overviewMetrics,
    topProducts,
    bestProducts,
    weakProducts,
    cartOpportunityProducts,
  };

  return {
    promptData,
    structuredData,
    inputSnapshot,
    reportTitle,
    reportSummary,
    riskLevel,
    tags,
  };
}

// 尝试调用 dashboard-data 函数获取上层聚合结果（优先使用）
async function fetchDashboardPayload(startDate: string, endDate: string) {
  try {
    const payload = await getDashboardPayload(startDate, endDate, { ads: true, crowd: true, single: false });
    return { success: true, ...payload };
  } catch (err) {
    console.warn('[ai-analysis] fetchDashboardPayload error', err);
    return null;
  }
}

// 把 dashboard-data 的 payload 转成 ai-analysis 需要的 DailyReportResult（尽量保留关键字段）

// ============ AI 调用（使用共享 minimax-client） =============

// ============ 主入口 =============

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const auth = await authenticateRequest(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header or invalid token' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const {
      start_date,
      end_date,
      analysis_type: analysisType = 'daily',
      source_tab: sourceTab = 'ads',
      template_key: requestedTemplateKey = 'daily',
      prompt_override: promptOverride = null,
      prompt_admin_token: promptAdminTokenFromBody = null,
      preview_only: previewOnly = false,
      publish = true,
      created_by: createdBy = null,
    } = await req.json();
    const templateKey = requestedTemplateKey === 'daily' && analysisType === 'single'
      ? 'single'
      : requestedTemplateKey;
    const promptAdminToken = req.headers.get('x-prompt-admin-token') ?? promptAdminTokenFromBody ?? '';
    const shouldPublish = Boolean(publish) && !previewOnly;

    // 限流：每分钟请求数限制
    const rateLimitKey = auth.type === 'prompt_admin'
      ? `admin:${auth.payload?.sub ?? 'unknown'}`
      : auth.type === 'supabase_user'
        ? `user:${auth.user?.id ?? auth.user?.email ?? 'unknown'}`
        : 'anonymous';

    // prompt_admin 限流更宽松（30 次/分钟），普通用户 10 次/分钟
    const rateLimitResult = checkRateLimit(rateLimitKey, {
      maxRequests: auth.type === 'prompt_admin' ? 30 : 10,
      windowMs: 60000,
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult);
    }

    // 每日次数限制（仅普通用户）
    if (auth.type !== 'prompt_admin') {
      const userId = auth.type === 'supabase_user' ? String(auth.user?.id || auth.user?.email || '') : '';
      if (userId) {
        const used = await checkDailyRunLimitForUser(userId);
        if (used >= AI_DAILY_LIMIT) {
          return new Response(JSON.stringify({ error: '当日 AI 分析调用额度已达上限，请联系管理员' }), {
            status: 429,
            headers: CORS_HEADERS,
          });
        }
      }
    }

    // 参数校验
    if (!start_date || !end_date) {
      return new Response(JSON.stringify({ error: '缺少 start_date 或 end_date' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // 日期格式校验
    const startDateValidation = validateDateString(start_date);
    if (!startDateValidation.valid) {
      return new Response(JSON.stringify({ error: startDateValidation.errors[0] }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    const endDateValidation = validateDateString(end_date);
    if (!endDateValidation.valid) {
      return new Response(JSON.stringify({ error: endDateValidation.errors[0] }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // prompt_override 输入验证
    if (promptOverride && typeof promptOverride === 'string') {
      const promptValidation = validatePromptInput(promptOverride);
      if (!promptValidation.valid) {
        return new Response(JSON.stringify({ error: `Prompt 输入无效: ${promptValidation.errors.join('，')}` }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
    }

    if (start_date > end_date) {
      return new Response(JSON.stringify({ error: 'start_date 不能大于 end_date' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    // 尝试优先使用 dashboard 的上层聚合结果，失败则回退到底表自聚合
    let reportResult = null;
    if (analysisType === 'single') {
      debugLog('[ai-analysis] 使用单品广告聚合结果作为输入');
      reportResult = await getSingleProductReport(start_date, end_date);
    } else {
      try {
        const dashboardPayload = await fetchDashboardPayload(start_date, end_date);
        if (dashboardPayload) {
          debugLog('[ai-analysis] 使用 dashboard-data 聚合结果作为输入');
          reportResult = buildReportFromDashboardPayload(dashboardPayload, start_date, end_date, analysisType, REPORT_SCHEMA_VERSION);
        }
      } catch (err) {
        console.warn('[ai-analysis] 使用 dashboard-data 构建 report 失败，回退到底表聚合', err);
        reportResult = null;
      }
    }

    if (!reportResult) {
      if (analysisType === 'single') {
        debugLog('[ai-analysis] 单品广告聚合结果为空');
      } else {
        debugLog('[ai-analysis] 使用底表自聚合(getDailyReport)作为输入');
        reportResult = await getDailyReport(start_date, end_date, analysisType);
      }
    }

    // 空数据拦截
    if (!reportResult) {
      return new Response(
        JSON.stringify({
          success: true,
          data: null,
          analysis: '该日期范围内无数据，跳过 AI 分析。',
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const promptDefinition = await resolvePromptRuntimeTemplate({
      templateKey,
      promptOverride,
      promptAdminToken,
    });

    // 并行加载5类补充 Prompt，按优先级拼接注入 system
    const [soulTemplate, redlinesTemplate, memoryTemplate, skillsTemplate, opsTemplate] = await Promise.allSettled([
      resolveActivePromptTemplate('soul'),
      resolveActivePromptTemplate('redlines'),
      resolveActivePromptTemplate('memory'),
      resolveActivePromptTemplate('skills'),
      resolveActivePromptTemplate('ops'),
    ]);

    const supplementSections: string[] = [];
    const sectionMap: Array<{ label: string; result: PromiseSettledResult<ActivePromptTemplate> }> = [
      { label: '【灵魂设定】', result: soulTemplate },
      { label: '【业务红线】', result: redlinesTemplate },
      { label: '【长期记忆】', result: memoryTemplate },
      { label: '【技能指令】', result: skillsTemplate },
      { label: '【运营业务背景】', result: opsTemplate },
    ];
    for (const { label, result } of sectionMap) {
      if (result.status === 'fulfilled') {
        const content = result.value.content.trim();
        if (content) supplementSections.push(`${label}\n${content}`);
      }
    }

    const combinedSystemPrompt = supplementSections.join('\n\n').trim();

    debugLog('[ai-analysis] system prompt sections loaded:', sectionMap.map(({ label, result }) => `${label}${result.status === 'fulfilled' ? '✅' : '❌'}`).join(' '));
    debugLog('[ai-analysis] system prompt preview (前500字):', combinedSystemPrompt.slice(0, 500));

    const prompt = buildPrompt(
      reportResult.promptData,
      templateKey,
      promptDefinition.content
    );
    debugLog('[ai-analysis] final prompt preview (前800字):', prompt.slice(0, 800));
    const analysis = await callMiniMax(prompt, combinedSystemPrompt, { maxTokens: 32768 });

    const headline = extractHeadlineFromAnalysis(analysis, reportResult.reportSummary);
    const reportPayload: StructuredReportPayload = {
      ...reportResult.structuredData,
      executiveSummary: {
        ...reportResult.structuredData.executiveSummary,
        headline,
      },
      markdown: analysis,
    };

    const promptMeta = {
      template_key: promptDefinition.templateKey,
      version_id: promptDefinition.versionId,
      version_label: promptDefinition.versionLabel,
      source: promptDefinition.source,
    };

    if (previewOnly) {
      return new Response(JSON.stringify({
        success: true,
        preview: true,
        data: reportResult.promptData,
        analysis,
        report: reportPayload,
        rendered_prompt: prompt,
        prompt_meta: promptMeta,
      }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    const finalCreatedBy = auth.type === 'prompt_admin'
      ? String(auth.payload?.email || auth.payload?.sub || '')
      : auth.type === 'supabase_user'
        ? String(auth.user?.email || auth.user?.id || '')
        : null;

    const runId = await insertAiReportRun({
      analysis_type: analysisType,
      source_tab: sourceTab,
      source_channel: 'dashboard_ai',
      source_range: {
        start_date,
        end_date,
      },
      start_date,
      end_date,
      status: 'completed',
      title: reportResult.reportTitle,
      summary: headline,
      risk_level: reportResult.riskLevel,
      model_name: 'MiniMax-M2.7',
      prompt_version: promptDefinition.versionLabel,
      prompt_template_key: promptDefinition.templateKey,
      prompt_version_id: promptDefinition.versionId,
      prompt_snapshot: promptDefinition.content,
      rendered_prompt: prompt,
      system_prompt: combinedSystemPrompt || null,
      overview_metrics: reportPayload.overviewMetrics,
      report_payload: reportPayload,
      input_snapshot: reportResult.inputSnapshot,
      raw_markdown: analysis,
      raw_response: analysis,
      created_by: finalCreatedBy,
    });

    let reportId: string | null = null;
    let reportSlug: string | null = null;
    let reportPersistError: string | null = null;
    if (shouldPublish) {
      const slug = buildReportSlug(analysisType, start_date, end_date);
      const upserted = await upsertAiReport({
        run_id: runId,
        slug,
        title: reportResult.reportTitle,
        report_type: analysisType,
        source_channel: 'dashboard_ai',
        source_range: {
          start_date,
          end_date,
        },
        report_date: end_date,
        start_date,
        end_date,
        status: 'published',
        visibility: 'team',
        summary: headline,
        risk_level: reportResult.riskLevel,
        executive_summary: reportPayload.executiveSummary,
        overview_metrics: reportPayload.overviewMetrics,
        highlights: reportPayload.issues,
        high_spend_crowds: reportPayload.highSpendCrowds,
        actions: reportPayload.actions,
        finance_adjustment: reportPayload.financeAdjustment,
        live_session_insight: reportPayload.liveSessionInsight,
        tags: reportResult.tags,
        raw_markdown: analysis,
        raw_payload: reportPayload,
        published_at: new Date().toISOString(),
        created_by: finalCreatedBy,
      });
      reportId = upserted.id;
      reportSlug = upserted.slug;
      if (!reportId && upserted.error) {
        reportPersistError = upserted.error;
      } else if (!reportId) {
        reportPersistError = '洞察中心写入失败（未返回原因），请查看 ai-analysis 日志或数据库 ai_reports 表';
      }
    }

    return new Response(JSON.stringify({
      success: true,
      run_id: runId,
      report_id: reportId,
      report_slug: reportSlug,
      report_persist_error: reportPersistError,
      data: reportResult.promptData,
      analysis,
      report: reportPayload,
      rendered_prompt: prompt,
      system_prompt: combinedSystemPrompt || null,
      prompt_meta: promptMeta,
    }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    const err = error as Error;
    const status = getErrorStatus(err);
    if (status === 429) {
      return new Response(JSON.stringify({ error: err.message }), {
        status,
        headers: CORS_HEADERS,
      });
    }
    return createErrorResponse(error, 'ai-analysis');
  }
});
