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
import {
  getFinancialTablesForDateRange,
  getSingleProductAdTablesForDateRange,
  getSuperLiveTablesForDateRange,
  getTaobaoLiveTablesForDateRange,
  type RoutedTable,
} from '../_shared/table-routes.ts';

// ============ 环境变量 =============
const MINIMAX_API_KEY = Deno.env.get('MINIMAX_API_KEY') ?? '';
const SB_URL = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL') ?? 'https://qjscsikithbxuxmjyjsp.supabase.co';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SB_SERVICE_ROLE_KEY') ??
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  '';
const MINIMAX_MODEL = 'MiniMax-M2.7';
const REPORT_SCHEMA_VERSION = 'v2-high-spend-ops';
const DAILY_SECTION_TITLES = ['大盘结论', '高消耗人群分析', '重点人群点名', '财务与退款修正', '明日执行建议'];
const SINGLE_SECTION_TITLES = ['单品整体结论', '高消耗商品分析', '高效率与低效率商品点名', '转化与加购机会', '明日执行建议'];
const ANALYSIS_SECTION_TITLES = [...new Set([...DAILY_SECTION_TITLES, ...SINGLE_SECTION_TITLES])];

const AI_DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '10');

function getAnalysisSectionTitles(analysisType: string): string[] {
  return analysisType === 'single' ? SINGLE_SECTION_TITLES : DAILY_SECTION_TITLES;
}

function parseContentRangeTotal(contentRange: string | null): number {
  if (!contentRange) return 0;
  const parts = contentRange.split('/');
  if (parts.length !== 2) return 0;
  const total = Number.parseInt(parts[1], 10);
  return Number.isFinite(total) ? total : 0;
}

async function authenticateRequest(req: Request) {
  return authenticateEdgeRequest(req, {
    allowPromptAdmin: true,
    allowSupabaseUser: true,
  });
}

async function checkDailyRunLimitForUser(userId: string | null) {
  if (!userId) return 0;
  try {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const iso = start.toISOString();
    const url = new URL(`${SB_URL}/rest/v1/ai_report_runs`);
    url.searchParams.set('select', 'id');
    url.searchParams.set('created_by', `eq.${userId}`);
    url.searchParams.set('created_at', `gte.${iso}`);

    const resp = await fetch(url.toString(), {
      headers: {
        ...getSupabaseHeaders(),
        Prefer: 'count=exact',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return 0;
    const total = parseContentRangeTotal(resp.headers.get('content-range'));
    return total;
  } catch (err) {
    console.warn('[ai-analysis] checkDailyRunLimitForUser error', err);
    return 0;
  }
}

function getSupabaseHeaders() {
  if (!SB_URL) {
    throw new Error('Missing SUPABASE_URL');
  }
  if (!SB_SERVICE_ROLE_KEY) {
    throw new Error(
      'Missing SUPABASE service role key. Please set SUPABASE_SERVICE_ROLE_KEY (preferred) or SB_SERVICE_ROLE_KEY.'
    );
  }
  return {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    Accept: 'application/json',
  };
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

type MetricBucket = {
  cost: number;
  amount: number;
  orders: number;
  views: number;
  shows: number;
  directAmount: number;
  cart: number;
  preOrders: number;
  interactions: number;
};

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type BudgetDecision = 'increase' | 'observe' | 'reduce';
type ActionPriority = 'p0' | 'p1' | 'p2';
type OverallJudgement = 'positive' | 'cautious' | 'negative';

type CrowdInsight = {
  name: string;
  cost: number;
  costShare: number;
  roi: number;
  orderCost: number;
  orders: number;
  decision: BudgetDecision;
  reason: string;
};

type SegmentInsight = {
  name: string;
  category: string;
  cost: number;
  costShare: number;
  roi: number;
  orderCost: number;
  decision: BudgetDecision;
  reason: string;
};

type CostStructureItem = {
  name: string;
  amount: number;
  share: number;
};

type LiveSessionItem = {
  name: string;
  amount: number;
  views: number;
  orders: number;
  buyerRate: number;
  refundRate: number;
};

type ProductInsight = {
  productId: string;
  name: string;
  cost: number;
  costShare: number;
  roi: number;
  orderCost: number;
  orders: number;
  amount: number;
  carts: number;
  views: number;
  decision: BudgetDecision;
  reason: string;
};

type ReportIssue = {
  title: string;
  severity: RiskLevel;
  evidence: string;
  impact: string;
};

type ReportAction = {
  title: string;
  target: string;
  reason: string;
  priority: ActionPriority;
};

type StructuredReportPayload = {
  meta: {
    reportType: string;
    startDate: string;
    endDate: string;
    generatedAt: string;
    version: string;
  };
  executiveSummary: {
    headline: string;
    overallJudgement: OverallJudgement;
    riskLevel: RiskLevel;
  };
  overviewMetrics: Record<string, string>;
  highSpendCrowds: CrowdInsight[];
  keySegments: SegmentInsight[];
  financeAdjustment: {
    summary: string;
    costStructure: CostStructureItem[];
    finMargin: string;
    returnRate: string;
  };
  liveSessionInsight: {
    summary: string;
    sessions: LiveSessionItem[];
  };
  issues: ReportIssue[];
  actions: ReportAction[];
  tomorrowFocus: string[];
  tags: string[];
  markdown?: string;
};

type DailyReportResult = {
  promptData: AnalysisData;
  structuredData: StructuredReportPayload;
  inputSnapshot: Record<string, unknown>;
  reportTitle: string;
  reportSummary: string;
  riskLevel: RiskLevel;
  tags: string[];
};

const toNum = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return parseFloat(value.replace(/,/g, '').trim()) || 0;
  return 0;
};

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toPercent(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

function buildReportTitle(analysisType: string, startDate: string, endDate: string): string {
  const label = analysisType === 'daily'
    ? '直播投放日报'
    : analysisType === 'single'
      ? '单品广告分析'
      : '直播投放分析';
  return startDate === endDate ? `${startDate} ${label}` : `${startDate} 至 ${endDate} ${label}`;
}

function buildReportSlug(analysisType: string, startDate: string, endDate: string): string {
  return `${analysisType}-${startDate}-${endDate}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^[\-\d.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAnalysisText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripAnalysisPreamble(text: string): string {
  const normalized = normalizeAnalysisText(text);
  if (!normalized) {
    return '';
  }

  const firstSectionIndex = ANALYSIS_SECTION_TITLES
    .map((title) => normalized.indexOf(title))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  const startsWithWeakPreamble = /^(好的，我|好的，|首先，我|根据提供的|让我|下面我|我将|我需要)/.test(normalized);
  if (Number.isInteger(firstSectionIndex) && (startsWithWeakPreamble || firstSectionIndex > 0)) {
    return normalized.slice(firstSectionIndex).trim();
  }

  return normalized;
}

function sanitizeAnalysisOutput(text: string): string {
  return stripAnalysisPreamble(text)
    .replace(/^(好的，我|好的，|首先，我|根据提供的).*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isWeakAnalysisLine(text: string): boolean {
  return [
    text.includes('我需要作为'),
    text.includes('我需要根据'),
    text.includes('首先，我需要'),
    text.includes('虽然说是昨日数据'),
    text.includes('暂且理解'),
    text.includes('让我思考'),
    text.includes('下面我来'),
    text.startsWith('好的，我'),
    text.startsWith('好的，'),
  ].some(Boolean);
}

function extractHeadlineFromAnalysis(analysis: string, fallback: string): string {
  const headingOnly = new Set(ANALYSIS_SECTION_TITLES);
  const lines = sanitizeAnalysisOutput(analysis)
    .split('\n')
    .map((line) => stripMarkdown(line))
    .filter((line) => line && !headingOnly.has(line) && !isWeakAnalysisLine(line));

  for (const line of lines) {
    if (line.length >= 12) {
      return line.slice(0, 120);
    }
  }

  return fallback;
}

function buildFallbackHeadline(
  riskLevel: RiskLevel,
  worstCrowd: CrowdInsight | undefined,
  bestCrowd: CrowdInsight | undefined,
  returnRate: number,
  finMargin: number
): string {
  if (riskLevel === 'critical' || riskLevel === 'high') {
    if (worstCrowd) {
      return `整体投放承压，${worstCrowd.name} 作为高消耗人群正在拖累整体效率，建议优先收缩。`;
    }
    return '整体投放承压，建议优先排查高消耗人群和退款对真实回报的侵蚀。';
  }

  if (bestCrowd && bestCrowd.decision === 'increase' && finMargin >= 10 && returnRate < 8) {
    return `整体表现相对稳健，${bestCrowd.name} 在高消耗人群中效率更优，可作为重点放量方向。`;
  }

  return '整体表现中性，建议继续围绕高消耗人群做结构优化并观察利润修正后的真实回报。';
}

function decideBudgetAction(roi: number, overallRoi: number, costShare: number): { decision: BudgetDecision; reason: string } {
  if (roi < 1) {
    return { decision: 'reduce', reason: 'ROI 低于 1，投入回报不足' };
  }

  if (costShare >= 20 && roi <= Math.max(1, overallRoi * 0.85)) {
    return { decision: 'reduce', reason: '高消耗但 ROI 明显低于整体' };
  }

  if (costShare >= 12 && roi >= overallRoi * 1.1) {
    return { decision: 'increase', reason: '高消耗且 ROI 优于整体，可继续承接预算' };
  }

  return { decision: 'observe', reason: '当前样本有效，但仍需继续观察波动' };
}

function rankHighSpendCrowds(
  crowdMap: Map<string, MetricBucket>,
  totalCost: number,
  overallRoi: number
): CrowdInsight[] {
  return [...crowdMap.entries()]
    .map(([name, bucket]) => {
      const roi = bucket.cost > 0 ? bucket.amount / bucket.cost : 0;
      const orderCost = bucket.orders > 0 ? bucket.cost / bucket.orders : 0;
      const costShare = totalCost > 0 ? (bucket.cost / totalCost) * 100 : 0;
      const { decision, reason } = decideBudgetAction(roi, overallRoi, costShare);
      return {
        name,
        cost: bucket.cost,
        costShare,
        roi,
        orderCost,
        orders: bucket.orders,
        decision,
        reason,
      };
    })
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);
}

function rankKeySegments(
  crowdNameMap: Map<string, { category: string; bucket: MetricBucket }>,
  totalCost: number,
  overallRoi: number
): SegmentInsight[] {
  const ranked = [...crowdNameMap.entries()]
    .map(([name, value]) => {
      const roi = value.bucket.cost > 0 ? value.bucket.amount / value.bucket.cost : 0;
      const orderCost = value.bucket.orders > 0 ? value.bucket.cost / value.bucket.orders : 0;
      const costShare = totalCost > 0 ? (value.bucket.cost / totalCost) * 100 : 0;
      const { decision, reason } = decideBudgetAction(roi, overallRoi, costShare);
      return {
        name,
        category: value.category,
        cost: value.bucket.cost,
        costShare,
        roi,
        orderCost,
        decision,
        reason,
      };
    })
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  if (ranked.length === 0) return [];

  const pool = ranked.slice(0, Math.min(8, ranked.length));
  const selected: SegmentInsight[] = [];

  const pushUnique = (item?: SegmentInsight) => {
    if (!item) return;
    if (selected.some((row) => row.name === item.name)) return;
    selected.push(item);
  };

  pushUnique(pool[0]);
  pushUnique([...pool].sort((a, b) => b.roi - a.roi || b.cost - a.cost)[0]);
  pushUnique([...pool].sort((a, b) => a.roi - b.roi || b.cost - a.cost)[0]);

  return selected.slice(0, 3);
}

function rankCostStructure(costItems: Array<[string, number]>, totalFinCost: number): CostStructureItem[] {
  return costItems
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, amount]) => ({
      name,
      amount,
      share: totalFinCost > 0 ? (amount / totalFinCost) * 100 : 0,
    }));
}

function rankLiveSessions(taobaoData: any[]): LiveSessionItem[] {
  const sessionMap = new Map<string, LiveSessionItem>();

  for (const row of taobaoData) {
    const sessionName = String(row['场次信息'] ?? '').trim() || String(row['日期'] ?? '未命名场次');
    const current = sessionMap.get(sessionName) ?? {
      name: sessionName,
      amount: 0,
      views: 0,
      orders: 0,
      buyerRate: 0,
      refundRate: 0,
    };
    const nextViews = current.views + toNum(row['观看人数']);
    const nextAmount = current.amount + toNum(row['成交金额']);
    const nextOrders = current.orders + toNum(row['成交笔数']);
    const buyers = toNum(row['成交人数']);
    const refunds = toNum(row['退款金额']);

    sessionMap.set(sessionName, {
      name: sessionName,
      amount: nextAmount,
      views: nextViews,
      orders: nextOrders,
      buyerRate: nextViews > 0 ? ((buyers + current.buyerRate * current.views / 100) / nextViews) * 100 : 0,
      refundRate: nextAmount > 0 ? ((refunds + current.refundRate * current.amount / 100) / nextAmount) * 100 : 0,
    });
  }

  return [...sessionMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 2);
}

function summarizeHighSpendCrowds(items: CrowdInsight[]): string {
  if (items.length === 0) return '暂无人群分类数据';

  return items
    .map(
      (item, index) =>
        `${index + 1}.${item.name} 花费¥${item.cost.toFixed(0)}（占比${item.costShare.toFixed(1)}%），ROI ${item.roi.toFixed(2)}，成交${Math.round(item.orders)}单，订单成本¥${item.orderCost.toFixed(1)}`
    )
    .join('；');
}

function summarizeKeySegments(items: SegmentInsight[]): string {
  if (items.length === 0) return '暂无具体人群数据';

  const labels = ['高消耗重点', '高消耗优质', '高消耗预警'];
  return items
    .map(
      (item, index) =>
        `${labels[index] ?? '重点人群'}：${item.name}（${item.category}），花费¥${item.cost.toFixed(0)}，ROI ${item.roi.toFixed(2)}，订单成本¥${item.orderCost.toFixed(1)}`
    )
    .join('；');
}

function summarizeCostStructure(items: CostStructureItem[]): string {
  if (items.length === 0) return '暂无成本拆分数据';
  return items
    .map((item) => `${item.name}¥${item.amount.toFixed(0)}（占成本${item.share.toFixed(1)}%）`)
    .join('；');
}

function summarizeLiveSessions(items: LiveSessionItem[]): string {
  if (items.length === 0) return '暂无直播场次数据';
  return `共${items.length}个重点场次；${items
    .map(
      (item) =>
        `${item.name} 成交¥${item.amount.toFixed(0)}，观看${Math.round(item.views)}，成交笔数${Math.round(item.orders)}，退款率${item.refundRate.toFixed(2)}%`
    )
    .join('；')}`;
}

function rankSingleProducts(rows: any[], totalCost: number, overallRoi: number): ProductInsight[] {
  const productMap = new Map<string, {
    productId: string;
    name: string;
    cost: number;
    amount: number;
    orders: number;
    carts: number;
    views: number;
  }>();

  for (const row of rows) {
    const productId = String(row['商品id'] ?? '').trim() || String(row['商品名称'] ?? 'unknown');
    const name = String(row['商品名称'] ?? '').trim() || '未命名商品';
    const current = productMap.get(productId) ?? {
      productId,
      name,
      cost: 0,
      amount: 0,
      orders: 0,
      carts: 0,
      views: 0,
    };

    current.cost += toNum(row['花费']);
    current.amount += toNum(row['该商品直接成交金额'] ?? row['直接成交金额']);
    current.orders += toNum(row['该商品直接成交笔数'] ?? row['直接成交笔数']);
    current.carts += toNum(row['该商品加购数']);
    current.views += toNum(row['观看人数']);
    productMap.set(productId, current);
  }

  return [...productMap.values()]
    .map((item) => {
      const roi = item.cost > 0 ? item.amount / item.cost : 0;
      const orderCost = item.orders > 0 ? item.cost / item.orders : 0;
      const costShare = totalCost > 0 ? (item.cost / totalCost) * 100 : 0;
      const { decision, reason } = decideBudgetAction(roi, overallRoi, costShare);
      return {
        ...item,
        roi,
        orderCost,
        costShare,
        decision,
        reason,
      };
    })
    .filter((item) => item.cost > 0)
    .sort((left, right) => right.cost - left.cost);
}

function summarizeSingleProducts(items: ProductInsight[]): string {
  if (!items.length) return '暂无单品广告数据';
  return items
    .slice(0, 3)
    .map((item, index) =>
      `${index + 1}.${item.name} 花费¥${item.cost.toFixed(0)}（占比${item.costShare.toFixed(1)}%），商品ROI ${item.roi.toFixed(2)}，商品成交${Math.round(item.orders)}单，加购${Math.round(item.carts)}次`
    )
    .join('；');
}

function summarizeBestSingleProducts(items: ProductInsight[]): string {
  const candidates = items
    .filter((item) => item.cost >= 1000 || item.orders > 0)
    .sort((left, right) => right.roi - left.roi || right.amount - left.amount)
    .slice(0, 3);
  if (!candidates.length) return '暂无高效率商品';
  return candidates
    .map((item, index) =>
      `${index + 1}.${item.name} 商品ROI ${item.roi.toFixed(2)}，商品成交¥${item.amount.toFixed(0)}，订单成本¥${item.orderCost.toFixed(1)}`
    )
    .join('；');
}

function summarizeWeakSingleProducts(items: ProductInsight[], overallRoi: number): string {
  const candidates = items
    .filter((item) => item.cost > 0 && (item.orders === 0 || item.roi < Math.max(1, overallRoi * 0.7)))
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 3);
  if (!candidates.length) return '暂无明显低效率商品';
  return candidates
    .map((item, index) =>
      `${index + 1}.${item.name} 花费¥${item.cost.toFixed(0)}，商品ROI ${item.roi.toFixed(2)}，商品成交${Math.round(item.orders)}单`
    )
    .join('；');
}

function summarizeCartOpportunities(items: ProductInsight[]): string {
  const candidates = items
    .filter((item) => item.carts > 0 || item.views > 0)
    .sort((left, right) => (right.carts - left.carts) || (right.views - left.views))
    .slice(0, 3);
  if (!candidates.length) return '暂无明显加购机会';
  return candidates
    .map((item, index) => {
      const cartRate = item.views > 0 ? (item.carts / item.views) * 100 : 0;
      return `${index + 1}.${item.name} 观看${Math.round(item.views)}，加购${Math.round(item.carts)}，加购率${cartRate.toFixed(2)}%`;
    })
    .join('；');
}

function buildSingleRiskLevel(roi: number, zeroOrderCostShare: number): RiskLevel {
  if (roi < 1 || zeroOrderCostShare >= 45) return 'critical';
  if (roi < 1.5 || zeroOrderCostShare >= 30) return 'high';
  if (roi < 2 || zeroOrderCostShare >= 15) return 'medium';
  return 'low';
}

function buildSingleFallbackHeadline(riskLevel: RiskLevel, topProduct?: ProductInsight, bestProduct?: ProductInsight): string {
  if ((riskLevel === 'critical' || riskLevel === 'high') && topProduct) {
    return `单品投放承压，${topProduct.name} 作为高消耗商品需要优先复盘是否继续承接预算。`;
  }
  if (bestProduct && bestProduct.roi >= 2) {
    return `单品投放结构可优化，${bestProduct.name} 当前效率更优，可作为优先放量对象。`;
  }
  return '单品投放整体表现中性，建议继续围绕高消耗商品做结构优化。';
}

function buildRiskLevel(params: {
  roi: number;
  returnRoi: number;
  finMargin: number;
  returnRate: number;
  yoyRoiDelta: number | null;
}): RiskLevel {
  const { roi, returnRoi, finMargin, returnRate, yoyRoiDelta } = params;
  if (returnRoi < 1 || finMargin < 0) return 'critical';
  if (returnRoi < 1.5 || finMargin < 5 || returnRate >= 15 || (yoyRoiDelta !== null && yoyRoiDelta <= -20)) return 'high';
  if (roi < 2 || finMargin < 10 || returnRate >= 8 || (yoyRoiDelta !== null && yoyRoiDelta <= -10)) return 'medium';
  return 'low';
}

function pickOverallJudgement(riskLevel: RiskLevel): OverallJudgement {
  if (riskLevel === 'low') return 'positive';
  if (riskLevel === 'medium') return 'cautious';
  return 'negative';
}

function buildIssues(args: {
  worstCrowd?: CrowdInsight;
  bestCrowd?: CrowdInsight;
  returnRate: number;
  finMargin: number;
  liveSessions: LiveSessionItem[];
  viewConvertRate: number;
}): ReportIssue[] {
  const { worstCrowd, bestCrowd, returnRate, finMargin, liveSessions, viewConvertRate } = args;
  const issues: ReportIssue[] = [];

  if (worstCrowd && worstCrowd.decision === 'reduce') {
    issues.push({
      title: `${worstCrowd.name} 高消耗低效率`,
      severity: 'high',
      evidence: `花费占比 ${worstCrowd.costShare.toFixed(1)}%，ROI ${worstCrowd.roi.toFixed(2)}`,
      impact: '会直接拖累整体投放效率和预算利用率',
    });
  }

  if (returnRate >= 8) {
    issues.push({
      title: '退款侵蚀真实回报',
      severity: returnRate >= 15 ? 'critical' : 'high',
      evidence: `退货率 ${returnRate.toFixed(2)}%`,
      impact: '表面 ROI 与真实经营 ROI 可能出现明显偏差',
    });
  }

  if (finMargin < 10) {
    issues.push({
      title: '毛利率承压',
      severity: finMargin < 0 ? 'critical' : 'medium',
      evidence: `毛利率 ${finMargin.toFixed(2)}%`,
      impact: '即使成交看起来不错，利润空间也可能不足',
    });
  }

  const topSession = liveSessions[0];
  if (topSession && topSession.refundRate >= 8) {
    issues.push({
      title: '头部场次退款率偏高',
      severity: 'medium',
      evidence: `${topSession.name} 退款率 ${topSession.refundRate.toFixed(2)}%`,
      impact: '会削弱高流量场次的真实成交价值',
    });
  }

  if (viewConvertRate < 2) {
    issues.push({
      title: '观看转化偏弱',
      severity: 'medium',
      evidence: `观看转化率 ${viewConvertRate.toFixed(2)}%`,
      impact: '流量已进场，但承接效率不足',
    });
  }

  if (issues.length === 0 && bestCrowd) {
    issues.push({
      title: `${bestCrowd.name} 可作为正向样本`,
      severity: 'low',
      evidence: `ROI ${bestCrowd.roi.toFixed(2)}，花费占比 ${bestCrowd.costShare.toFixed(1)}%`,
      impact: '可作为后续放量和优化参考对象',
    });
  }

  return issues.slice(0, 4);
}

function buildActions(args: {
  worstCrowd?: CrowdInsight;
  bestCrowd?: CrowdInsight;
  worstSegment?: SegmentInsight;
  bestSegment?: SegmentInsight;
  returnRate: number;
  finMargin: number;
  topCostItem?: CostStructureItem;
  topSession?: LiveSessionItem;
}): ReportAction[] {
  const { worstCrowd, bestCrowd, worstSegment, bestSegment, returnRate, finMargin, topCostItem, topSession } = args;
  const actions: ReportAction[] = [];

  if (worstCrowd && worstCrowd.decision === 'reduce') {
    actions.push({
      title: `下调 ${worstCrowd.name} 预算`,
      target: worstCrowd.name,
      reason: worstCrowd.reason,
      priority: 'p0',
    });
  }

  if (bestCrowd && bestCrowd.decision === 'increase') {
    actions.push({
      title: `保留并放量 ${bestCrowd.name}`,
      target: bestCrowd.name,
      reason: bestCrowd.reason,
      priority: 'p1',
    });
  }

  if (worstSegment && worstSegment.decision === 'reduce') {
    actions.push({
      title: `收缩具体人群 ${worstSegment.name}`,
      target: worstSegment.name,
      reason: `${worstSegment.category} 内部低效高消耗`,
      priority: 'p0',
    });
  }

  if (bestSegment && bestSegment.decision === 'increase') {
    actions.push({
      title: `复制 ${bestSegment.name} 的预算分配逻辑`,
      target: bestSegment.name,
      reason: '该人群在高消耗样本中效率更优',
      priority: 'p1',
    });
  }

  if (returnRate >= 8) {
    actions.push({
      title: '复盘退款高的订单来源',
      target: '退款订单',
      reason: '避免表面 ROI 掩盖真实经营问题',
      priority: 'p0',
    });
  }

  if (finMargin < 10 && topCostItem) {
    actions.push({
      title: `排查 ${topCostItem.name} 成本占比`,
      target: topCostItem.name,
      reason: '毛利率承压，需要优先看大头成本',
      priority: 'p1',
    });
  }

  if (topSession && topSession.refundRate >= 8) {
    actions.push({
      title: `重点复盘场次 ${topSession.name}`,
      target: topSession.name,
      reason: '头部场次退款偏高，需要排查承接与商品匹配',
      priority: 'p2',
    });
  }

  return actions.slice(0, 5);
}

function buildTomorrowFocus(args: {
  worstCrowd?: CrowdInsight;
  returnRate: number;
  finMargin: number;
  topSession?: LiveSessionItem;
}): string[] {
  const items = ['整体 ROI', '去退 ROI'];
  if (args.worstCrowd) items.push(`${args.worstCrowd.name} ROI`);
  if (args.returnRate >= 5) items.push('退款率');
  if (args.finMargin < 10) items.push('毛利率');
  if (args.topSession) items.push(`${args.topSession.name} 退款率`);
  return uniqueStrings(items).slice(0, 5);
}

function buildTags(args: {
  riskLevel: RiskLevel;
  highSpendCrowds: CrowdInsight[];
  returnRate: number;
  finMargin: number;
  topSession?: LiveSessionItem;
}): string[] {
  const tags = ['高消耗人群'];
  if (args.highSpendCrowds.some((item) => item.decision === 'reduce')) tags.push('预算调整');
  if (args.highSpendCrowds.some((item) => item.decision === 'increase')) tags.push('放量对象');
  if (args.returnRate >= 5) tags.push('退款修正');
  if (args.finMargin < 10) tags.push('利润承压');
  if (args.topSession) tags.push('场次承接');
  if (args.riskLevel === 'critical' || args.riskLevel === 'high') tags.push('高风险');
  return uniqueStrings(tags);
}

function classifyCrowd(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return '未知';

  const text = name.trim();

  if (text === '智能推荐人群' || text.startsWith('智能竞争直播间:')) return '纯黑盒';
  if (text.startsWith('自定义竞争宝贝:')) return '灰盒_竞争宝贝';
  if (text.startsWith('自定义竞争店铺:')) return '灰盒_竞争店铺';
  if (text.startsWith('自定义竞争直播间:')) return '灰盒_竞争直播间';

  if (['复购老客', '未通知到人群', '购买人群', '活跃成交', '活跃复购'].some((k) => text.includes(k))) {
    return '老客';
  }

  if (
    text.startsWith('粉丝人群:') ||
    text.startsWith('喜欢我的直播:') ||
    text.startsWith('喜欢我的短视频:') ||
    ['加购人群', '兴趣新客', '访问新客', '浏览'].some((k) => text.includes(k))
  ) {
    return '兴趣新客';
  }

  if (['首购新客', '差老客', '付定人群', '流失', '竞店人群'].some((k) => text.includes(k))) {
    return '新客';
  }

  if (text.startsWith('精选人群:') || text.startsWith('达摩盘人群:')) {
    if (['活跃复购', '活跃成交', '活跃下降', '即将流失', '差直播间老客', '差老客', '购买人群'].some((k) => text.includes(k))) {
      return '老客';
    }
    if (['加购人群', '兴趣新客', '访问新客', '浏览'].some((k) => text.includes(k))) {
      return '兴趣新客';
    }
    if (['首购新客', '未购', '流失', '竞店人群', '付定人群'].some((k) => text.includes(k))) {
      return '新客';
    }
    if (['宠物清洁', '直播低退', '达人带货品牌'].some((k) => text.includes(k))) {
      return '灰盒_竞争宝贝';
    }
    return '灰盒';
  }

  if (text.includes('活跃')) return '新客';
  return '未知';
}

function createMetricBucket(): MetricBucket {
  return {
    cost: 0,
    amount: 0,
    orders: 0,
    views: 0,
    shows: 0,
    directAmount: 0,
    cart: 0,
    preOrders: 0,
    interactions: 0,
  };
}

function accumulateMetrics(bucket: MetricBucket, row: any): void {
  bucket.cost += toNum(row['花费']);
  bucket.amount += toNum(row['总成交金额']);
  bucket.orders += toNum(row['总成交笔数']);
  bucket.views += toNum(row['观看次数']);
  bucket.shows += toNum(row['展现量']);
  bucket.directAmount += toNum(row['直接成交金额']);
  bucket.cart += toNum(row['总购物车数']);
  bucket.preOrders += toNum(row['总预售成交笔数']);
  bucket.interactions += toNum(row['互动量']);
}

function buildHighSpendCrowdSummary(crowdMap: Map<string, MetricBucket>, totalCost: number): string {
  return summarizeHighSpendCrowds(rankHighSpendCrowds(crowdMap, totalCost, 0));
}

function buildCrowdNameSummary(
  crowdNameMap: Map<string, { category: string; bucket: MetricBucket }>
): string {
  return summarizeKeySegments(rankKeySegments(crowdNameMap, 0, 0));
}

function buildCostStructureSummary(costItems: Array<[string, number]>, totalFinCost: number): string {
  return summarizeCostStructure(rankCostStructure(costItems, totalFinCost));
}

function buildLiveSessionSummary(taobaoData: any[]): string {
  return summarizeLiveSessions(rankLiveSessions(taobaoData));
}

// ============ 数据查询 =============

const DATE_COLUMN = '日期';
const AI_SUPER_LIVE_COLUMNS = [
  '日期',
  '花费',
  '总成交金额',
  '总成交笔数',
  '观看次数',
  '展现量',
  '直接成交金额',
  '总购物车数',
  '总预售成交笔数',
  '互动量',
  '人群名字',
];
const AI_FINANCIAL_COLUMNS = [
  '日期',
  '业务口径收入',
  '支付gmv',
  '成本合计',
  '毛利',
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
];
const AI_TAOBAO_LIVE_COLUMNS = [
  '日期',
  '场次信息',
  '观看人数',
  '成交金额',
  '成交笔数',
  '成交人数',
  '退款金额',
];

/** 从 Supabase REST API 按 日期 范围读取数据（带分页） */
async function fetchTableData(
  table: string,
  selectColumns: string[],
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const allData: any[] = [];
  const batchSize = 1000;
  const maxPages = 200;
  let offset = 0;
  let page = 0;

  while (page < maxPages) {
    const url = new URL(`${SB_URL}/rest/v1/${table}`);
    url.searchParams.set('select', selectColumns.join(','));
    url.searchParams.set(DATE_COLUMN, `gte.${startDate}`);
    url.searchParams.append(DATE_COLUMN, `lte.${endDate}`);
    url.searchParams.set('limit', String(batchSize));
    url.searchParams.set('offset', String(offset));
    console.log(`[ai-analysis] Fetching ${table} ${DATE_COLUMN}=gte.${startDate}&${DATE_COLUMN}=lte.${endDate} page=${page + 1} offset=${offset}`);

    const resp = await fetch(url.toString(), {
      headers: getSupabaseHeaders(),
    });
    const respText = await resp.text();

    console.log(`[ai-analysis] ${table} resp status=${resp.status}`);
    if (!resp.ok) {
      if (resp.status === 404) {
        console.warn(`[ai-analysis] 表 ${table} 不存在，按空表处理。body=${respText}`);
        break;
      }
      console.error(`[ai-analysis] 查询表 ${table} 失败: ${resp.status} ${respText}`);
      throw new Error(`查询表 ${table} 失败: ${resp.status} ${respText}`);
    }

    let data: any[] = [];
    try {
      data = respText ? JSON.parse(respText) : [];
    } catch (error) {
      console.error(`[ai-analysis] ${table} JSON 解析失败: ${respText}`);
      throw new Error(
        `[${table}] JSON parse failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    console.log(`[ai-analysis] ${table} 批次行数: ${data.length}`);
    allData.push(...data);

    if (data.length === 0 || data.length < batchSize) {
      break;
    }

    offset += batchSize;
    page += 1;
  }

  if (page >= maxPages) {
    throw new Error(`查询表 ${table} 超过最大分页限制 ${maxPages}，已中止以避免死循环`);
  }

  return allData;
}

async function fetchRoutedTables(routedTables: RoutedTable[], selectColumns: string[]): Promise<any[]> {
  if (!routedTables.length) return [];
  const results = await Promise.all(
    routedTables.map(async ({ table, dates }) => {
      const sortedDates = [...dates].sort();
      const rangeStart = sortedDates[0];
      const rangeEnd = sortedDates[sortedDates.length - 1];
      const startedAt = Date.now();
      const rows = await fetchTableData(table, selectColumns, rangeStart, rangeEnd);
      console.log(`[ai-analysis] ${table} range rows=${rows.length} duration_ms=${Date.now() - startedAt}`);
      return rows;
    }),
  );
  return results.flat();
}

/** 对分页结果再按 日期 做一次收口过滤，日期列来自 Supabase date 类型。 */
function filterByDateRange(data: any[], startDate: string, endDate: string): any[] {
  return data.filter((r) => {
    const d = typeof r?.[DATE_COLUMN] === 'string' ? r[DATE_COLUMN].trim() : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= startDate && d <= endDate;
  });
}

/** 聚合超级直播核心指标 */
async function getDailyReport(
  startDate: string,
  endDate: string,
  analysisType: string
): Promise<DailyReportResult | null> {
  const superLiveTables = getSuperLiveTablesForDateRange(startDate, endDate);
  console.log(`[ai-analysis] 查询日期范围: ${startDate} ~ ${endDate}, 超级直播表: ${JSON.stringify(superLiveTables.map((item) => item.table))}`);
  console.log(
    `[ai-analysis] env check: SUPABASE_URL=${!!SB_URL}, SERVICE_ROLE_KEY=${!!SB_SERVICE_ROLE_KEY}`
  );

  // 并行加载 super_live_* 表，所有底表统一使用 日期 + gte/lte 范围过滤。
  const superLiveFlat = await fetchRoutedTables(superLiveTables, AI_SUPER_LIVE_COLUMNS);
  console.log(`[ai-analysis] super_live 总行数: ${superLiveFlat.length}, 前3行: ${JSON.stringify(superLiveFlat.slice(0,3))}`);
  const superLiveData = filterByDateRange(superLiveFlat, startDate, endDate);
  console.log(`[ai-analysis] super_live 过滤后行数: ${superLiveData.length}`);

  // 并行加载 financial 和 taobao_live
  const financialPromise = fetchRoutedTables(getFinancialTablesForDateRange(startDate, endDate), AI_FINANCIAL_COLUMNS);
  const taobaoPromise = fetchRoutedTables(getTaobaoLiveTablesForDateRange(startDate, endDate), AI_TAOBAO_LIVE_COLUMNS);

  const [financialRaw, taobaoRaw] = await Promise.all([financialPromise, taobaoPromise]);
  const financialData = filterByDateRange(financialRaw, startDate, endDate);
  const taobaoData = filterByDateRange(taobaoRaw, startDate, endDate);
  console.log(`[ai-analysis] financial 过滤后: ${financialData.length}, taobao_live 过滤后: ${taobaoData.length}`);

  // 空数据拦截
  if (superLiveData.length === 0 && financialData.length === 0 && taobaoData.length === 0) {
    console.log(`[ai-analysis] 空数据拦截`);
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

async function fetchSingleProductRows(startDate: string, endDate: string): Promise<any[]> {
  const allRows: any[] = [];
  const batchSize = 1000;

  for (const { table } of getSingleProductAdTablesForDateRange(startDate, endDate)) {
    let offset = 0;
    while (true) {
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

function fmtNum(v: unknown, digits = 2): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(digits) : '-';
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n.toFixed(digits) : String(v);
}

function fmtPct(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v.toFixed(2)}%`;
  return String(v ?? '-');
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万`;
  return n.toFixed(2);
}

// 通用：把 dashboard payload 里所有可用维度格式化成 Markdown 段落
function buildFullDataContext(payload: any, rankedProducts?: any[]): string {
  const sections: string[] = [];
  const ads = payload?.ads || {};
  const kpi = ads.kpi;
  const crowdRows = payload?.crowd?.summary || [];

  // --- 汇总 KPI ---
  if (kpi) {
    sections.push([
      '## 汇总 KPI',
      `- 总花费：¥${fmtMoney(kpi.totalCost)}`,
      `- 总成交额：¥${fmtMoney(kpi.totalAmount)}`,
      `- 总订单：${fmtNum(kpi.totalOrders, 0)}`,
      `- ROI：${fmtNum(kpi.avgRoi, 2)}　直接ROI：${fmtNum(kpi.avgDirectRoi, 2)}　去退ROI：${fmtNum(kpi.totalReturnRoi, 2)}`,
      `- 退货率：${fmtPct(kpi.totalReturnRate)}　观看成本：¥${fmtNum(kpi.avgViewCost, 3)}　订单成本：¥${fmtNum(kpi.avgOrderCost, 2)}`,
      `- 广告成交占比：${fmtPct(kpi.totalAdShare)}　千次展现成本：¥${fmtNum(kpi.avgCpm, 2)}`,
    ].join('\n'));
  }

  // --- 财务 ---
  if (kpi && (kpi.totalFinRevenue || kpi.finRevenue)) {
    sections.push([
      '## 财务数据',
      `- 收入：¥${fmtMoney(kpi.totalFinRevenue ?? kpi.finRevenue)}　成本：¥${fmtMoney(kpi.finCost)}　毛利：¥${fmtMoney(kpi.finProfit)}　毛利率：${kpi.finMargin ?? '-'}`,
      `- 保量佣金：¥${fmtMoney(kpi.finGuarantee)}　线下佣金：¥${fmtMoney(kpi.finOffline)}　机构佣金：¥${fmtMoney(kpi.finAgency)}`,
      `- 直播间红包：¥${fmtMoney(kpi.finRedPacket)}　严选红包：¥${fmtMoney(kpi.finYanxuanRed)}`,
    ].join('\n'));
  }

  // --- 每日趋势 ---
  if (ads.daily && ads.daily.length > 0) {
    const sorted = [...ads.daily].sort((a: any, b: any) => (a.label > b.label ? 1 : -1));
    const lines = [
      '## 每日趋势',
      '| 日期 | 花费 | 成交额 | ROI | 直接ROI | 去退ROI | 订单 | 观看 | 观看成本 | 转化率 |',
      '|------|------|--------|-----|---------|---------|------|------|----------|--------|',
    ];
    for (const r of sorted) {
      lines.push(`| ${r.label} | ¥${fmtMoney(r.cost)} | ¥${fmtMoney(r.amount)} | ${fmtNum(r.roi, 2)} | ${fmtNum(r.directRoi, 2)} | ${fmtNum(r.returnRoi, 2)} | ${fmtNum(r.orders, 0)} | ${fmtNum(r.views, 0)} | ¥${fmtNum(r.viewCost, 3)} | ${fmtPct(r.viewConvertRate)} |`);
    }
    sections.push(lines.join('\n'));
  }

  // --- 人群分层 ---
  if (crowdRows.length > 0) {
    const lines = [
      '## 人群分层汇总',
      '| 人群分类 | 花费 | 成交额 | ROI | 直接ROI | 订单 | 观看 | 观看成本 | 转化率 |',
      '|----------|------|--------|-----|---------|------|------|----------|--------|',
    ];
    for (const c of crowdRows) {
      const s = c.summary || c;
      lines.push(`| ${c.crowd || c.label || '-'} | ¥${fmtMoney(s.cost)} | ¥${fmtMoney(s.amount)} | ${fmtNum(s.roi, 2)} | ${fmtNum(s.directRoi, 2)} | ${fmtNum(s.orders, 0)} | ${fmtNum(s.views, 0)} | ¥${fmtNum(s.viewCost, 3)} | ${fmtPct(s.viewConvertRate)} |`);
    }
    sections.push(lines.join('\n'));

    // 子人群 Top 15
    const allSubs: any[] = [];
    for (const c of crowdRows) {
      for (const sub of (c.subRows || [])) {
        allSubs.push({ crowd: c.crowd || '-', ...sub });
      }
    }
    allSubs.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
    if (allSubs.length > 0) {
      const top = allSubs.slice(0, 15);
      const subLines = [
        '## 子人群 Top 明细（按花费排序）',
        '| 所属分类 | 子人群 | 花费 | 成交额 | ROI | 直接ROI | 订单 | 观看成本 | 转化率 |',
        '|----------|--------|------|--------|-----|---------|------|----------|--------|',
      ];
      for (const s of top) {
        subLines.push(`| ${s.crowd} | ${s.label || '-'} | ¥${fmtMoney(s.cost)} | ¥${fmtMoney(s.amount)} | ${fmtNum(s.roi, 2)} | ${fmtNum(s.directRoi, 2)} | ${fmtNum(s.orders, 0)} | ¥${fmtNum(s.viewCost, 3)} | ${fmtPct(s.viewConvertRate)} |`);
      }
      sections.push(subLines.join('\n'));
    }
  }

  // --- 单品商品明细 ---
  if (rankedProducts && rankedProducts.length > 0) {
    const lines = [
      `## 全部商品明细（${rankedProducts.length} 个商品，按花费排序）`,
      '| 商品名称 | 花费 | 占比 | 成交额 | ROI | 订单 | 加购 | 观看 | 订单成本 | 加购率 | 判断 |',
      '|----------|------|------|--------|-----|------|------|------|----------|--------|------|',
    ];
    for (const p of rankedProducts) {
      const cartRate = p.views > 0 ? ((p.carts / p.views) * 100).toFixed(1) + '%' : '-';
      const name = String(p.name || '').slice(0, 30);
      lines.push(`| ${name} | ¥${fmtMoney(p.cost)} | ${fmtNum(p.costShare, 1)}% | ¥${fmtMoney(p.amount)} | ${fmtNum(p.roi, 2)} | ${fmtNum(p.orders, 0)} | ${fmtNum(p.carts, 0)} | ${fmtNum(p.views, 0)} | ¥${fmtNum(p.orderCost, 1)} | ${cartRate} | ${p.decision || '-'} |`);
    }
    sections.push(lines.join('\n'));
  }

  // --- 淘宝直播 ---
  if (kpi && (kpi.totalTaobaoOrders || kpi.taobaoOrders)) {
    sections.push([
      '## 淘宝直播参考',
      `- 成交笔数：${fmtNum(kpi.totalTaobaoOrders ?? kpi.taobaoOrders, 0)}　成交金额：¥${fmtMoney(kpi.taobaoSales ?? kpi.totalTaobaoSales)}　退款金额：¥${fmtMoney(kpi.totalReturnAmount)}`,
    ].join('\n'));
  }

  return sections.length > 0 ? sections.join('\n\n') : '暂无可用数据';
}

function buildReportFromDashboardPayload(
  payload: any,
  startDate: string,
  endDate: string,
  analysisType: string
): DailyReportResult {
  const ads = payload.ads || {};
  const kpi = ads.kpi || {};
  const crowdRows = payload.crowd?.summary || [];

  const promptData: AnalysisData = {
    dateRange: `${startDate} ~ ${endDate}`,
    fullDataContext: buildFullDataContext(payload),
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
      headline: '基于看板聚合数据的 AI 分析',
      overallJudgement: 'cautious',
      riskLevel: 'medium',
    },
    overviewMetrics: {
      totalCost: fmtNum(kpi.totalCost, 2),
      totalAmount: fmtNum(kpi.totalAmount, 2),
      totalOrders: fmtNum(kpi.totalOrders, 0),
      roi: fmtNum(kpi.avgRoi, 3),
      returnRoi: fmtNum(kpi.totalReturnRoi, 3),
      finMargin: String(kpi.finMargin ?? '数据不足'),
      returnRate: typeof kpi.totalReturnRate === 'number' ? `${kpi.totalReturnRate.toFixed(2)}%` : '数据不足',
    },
    highSpendCrowds: [],
    keySegments: [],
    financeAdjustment: {
      summary: '参考看板成本拆分',
      costStructure: [],
      finMargin: String(kpi.finMargin ?? '数据不足'),
      returnRate: typeof kpi.totalReturnRate === 'number' ? `${kpi.totalReturnRate.toFixed(2)}%` : '数据不足',
    },
    liveSessionInsight: {
      summary: (ads?.daily && ads.daily.length > 0) ? `共 ${ads.daily.length} 天数据` : '暂无直播场次数据',
      sessions: [],
    },
    issues: [],
    actions: [],
    tomorrowFocus: [],
    tags: [],
  };

  const inputSnapshot = {
    reportTitle: buildReportTitle(analysisType, startDate, endDate),
    dateRange: promptData.dateRange,
    sourceMetrics: structuredData.overviewMetrics,
    highSpendCrowds: [],
    keySegments: [],
    costStructure: [],
    liveSessions: [],
  };

  return {
    promptData,
    structuredData,
    inputSnapshot,
    reportTitle: buildReportTitle(analysisType, startDate, endDate),
    reportSummary: '基于看板聚合数据的快速分析',
    riskLevel: 'medium',
    tags: [],
  };
}

// ============ AI 调用 =============

async function callMiniMax(prompt: string, systemPrompt?: string, analysisType = 'daily'): Promise<string> {
  if (!MINIMAX_API_KEY) {
    throw new Error('Missing MINIMAX_API_KEY');
  }

  const response = await fetch('https://api.minimax.chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      max_tokens: 4096,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[ai-analysis] MiniMax API 错误: ${response.status} - ${errText}`);
    throw new Error(`MiniMax API error: ${response.status}`);
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content ?? '';
}

async function insertAiReportRun(payload: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(`${SB_URL}/rest/v1/ai_report_runs`, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ai-analysis] 写入 ai_report_runs 失败: ${response.status} ${errorText}`);
      return null;
    }
    const rows = await response.json();
    return rows?.[0]?.id ?? null;
  } catch (error) {
    console.error('[ai-analysis] 写入 ai_report_runs 异常', error);
    return null;
  }
}

async function upsertAiReport(
  payload: Record<string, unknown>,
): Promise<{ id: string | null; slug: string | null; error: string | null }> {
  try {
    const response = await fetch(`${SB_URL}/rest/v1/ai_reports?on_conflict=slug`, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ai-analysis] 写入 ai_reports 失败: ${response.status} ${errorText}`);
      return { id: null, slug: null, error: errorText.slice(0, 800) };
    }

    const rows = await response.json();
    return {
      id: rows?.[0]?.id ?? null,
      slug: rows?.[0]?.slug ?? null,
      error: null,
    };
  } catch (error) {
    console.error('[ai-analysis] 写入 ai_reports 异常', error);
    const message = error instanceof Error ? error.message : String(error);
    return { id: null, slug: null, error: message.slice(0, 800) };
  }
}

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
    const shouldPublish = Boolean(publish) && !Boolean(previewOnly);

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
      console.log('[ai-analysis] 使用单品广告聚合结果作为输入');
      reportResult = await getSingleProductReport(start_date, end_date);
    } else {
      try {
        const dashboardPayload = await fetchDashboardPayload(start_date, end_date);
        if (dashboardPayload) {
          console.log('[ai-analysis] 使用 dashboard-data 聚合结果作为输入');
          reportResult = buildReportFromDashboardPayload(dashboardPayload, start_date, end_date, analysisType);
        }
      } catch (err) {
        console.warn('[ai-analysis] 使用 dashboard-data 构建 report 失败，回退到底表聚合', err);
        reportResult = null;
      }
    }

    if (!reportResult) {
      if (analysisType === 'single') {
        console.log('[ai-analysis] 单品广告聚合结果为空');
      } else {
        console.log('[ai-analysis] 使用底表自聚合(getDailyReport)作为输入');
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

    console.log('[ai-analysis] system prompt sections loaded:', sectionMap.map(({ label, result }) => `${label}${result.status === 'fulfilled' ? '✅' : '❌'}`).join(' '));
    console.log('[ai-analysis] system prompt preview (前500字):', combinedSystemPrompt.slice(0, 500));

    const prompt = buildPrompt(
      reportResult.promptData,
      templateKey,
      promptDefinition.content
    );
    console.log('[ai-analysis] final prompt preview (前800字):', prompt.slice(0, 800));
    const analysis = await callMiniMax(prompt, combinedSystemPrompt, analysisType);

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
      start_date,
      end_date,
      status: 'completed',
      title: reportResult.reportTitle,
      summary: headline,
      risk_level: reportResult.riskLevel,
      model_name: MINIMAX_MODEL,
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
