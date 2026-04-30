import { classifyDimensionValue, getDashboardSpec } from './dashboard-spec.ts';
import { getSupabaseHeaders, SB_URL } from './supabase-client.ts';
import { aggregateSingleByProduct, buildSingleKpiPayload, dedupeSingleProductRows } from './single-product.ts';
import { debugLog } from './logger.ts';
import {
  getFinancialTablesForDateRange,
  getSingleProductAdTablesForDateRange,
  getSuperLiveTablesForDateRange,
  getTaobaoLiveTablesForDateRange,
  type RoutedTable,
} from './table-routes.ts';

const FINANCIAL_COLUMNS = ['日期', '保量佣金', '预估结算线下佣金', '预估结算机构佣金', '直播间红包', '严选红包'];
const TAOBAO_LIVE_COLUMNS = ['日期', '成交笔数', '退款金额', '成交金额'];
const SUPER_LIVE_BASE_COLUMNS = [
  '日期',
  '花费',
  '总成交金额',
  '总成交笔数',
  '观看次数',
  '展现量',
  '直接成交金额',
  '总购物车数',
  '总收藏数',
  '总预售成交笔数',
  '互动量',
];
const SUPER_LIVE_CROWD_COLUMNS = [...SUPER_LIVE_BASE_COLUMNS, '人群名字'];
const SINGLE_PRODUCT_COLUMNS = ['id', '日期', '商品id', '商品名称', 'img_url', '花费', '直接成交笔数', '直接成交金额', '该商品直接成交笔数', '该商品直接成交金额', '该商品加购数', '该商品收藏数', '观看人数'];
const ADS_SUMMARY_COLUMNS = [
  '日期',
  '花费',
  '总成交金额',
  '总成交笔数',
  '观看次数',
  '展现量',
  '直接成交金额',
  '总购物车数',
  '总收藏数',
  '总预售成交笔数',
  '互动量',
  '保量佣金',
  '预估结算线下佣金',
  '预估结算机构佣金',
  '直播间红包',
  '严选红包',
  '淘宝直播成交笔数',
  '淘宝直播成交金额',
  '淘宝直播退款金额',
  'source_super_live_rows',
  'source_financial_rows',
  'source_taobao_rows',
];
const CROWD_SUMMARY_COLUMNS = [
  '日期',
  '人群分类',
  '人群名字',
  '花费',
  '总成交金额',
  '总成交笔数',
  '观看次数',
  '展现量',
  '直接成交金额',
  '总购物车数',
  '总收藏数',
  '总预售成交笔数',
  '互动量',
  'source_row_count',
];
const SINGLE_PRODUCT_SUMMARY_COLUMNS = [
  '日期',
  '商品id',
  '商品名称',
  'img_url',
  '花费',
  '直接成交笔数',
  '直接成交金额',
  '该商品直接成交笔数',
  '该商品直接成交金额',
  '该商品加购数',
  '该商品收藏数',
  '观看人数',
  'source_row_count',
];
const REST_PAGE_SIZE = 1000;
const REST_MAX_ATTEMPTS = 3;
const REST_RETRY_BASE_DELAY_MS = 300;
const REST_FETCH_TIMEOUT_MS = 12000;
const REST_TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const DATE_COLUMN = '日期';
const DASHBOARD_CURRENT_CACHE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_HISTORICAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DASHBOARD_PAYLOAD_CACHE_MAX_ENTRIES = 60;

type DashboardSpec = Awaited<ReturnType<typeof getDashboardSpec>>;
type CrowdLayerConfig = DashboardSpec['dimensions']['crowdLayer'];

type AggregateBucket = {
  cost: number;
  amount: number;
  orders: number;
  views: number;
  shows: number;
  directAmount: number;
  cart: number;
  fav: number;
  preOrders: number;
  interactions: number;
  finGuarantee: number;
  finOffline: number;
  finAgency: number;
  finRedPacket: number;
  finYanxuanRed: number;
  taobaoOrders: number;
  taobaoRefund: number;
  taobaoAmount: number;
  dates?: Set<string>;
};

type DisplayRow = {
  label: string;
  cost: number;
  amount: number;
  orders: number;
  views: number;
  shows: number;
  directAmount: number;
  cart: number;
  fav: number;
  preOrders: number;
  interactions: number;
  roi: number;
  directRoi: number;
  viewCost: number;
  orderCost: number;
  cartCost: number;
  preOrderCost: number;
  viewConvertRate: number;
  deepInteractRate: number;
  viewRate: number;
  cpm: number;
  finGuarantee: number;
  finOffline: number;
  finAgency: number;
  finRedPacket: number;
  finYanxuanRed: number;
  taobaoOrders: number;
  taobaoRefund: number;
  taobaoAmount: number;
  taobaoReturnRate: number;
  adRevenue: number | null;
  breakevenRoi: number | null;
  returnRoi: number;
  adShare: number;
  computableDays: number;
  skippedDays: number;
};

type RequestedSections = {
  ads: boolean;
  crowd: boolean;
  single: boolean;
};

type DashboardPayloadCacheEntry = {
  cachedAt: number;
  payload: Record<string, unknown>;
};

type RestQueryOptions = {
  rangeGte: string;
  rangeLte: string;
};

const dashboardPayloadCache = new Map<string, DashboardPayloadCacheEntry>();

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getShanghaiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getDashboardPayloadCacheTtlMs(endDate: string): number {
  return endDate < getShanghaiToday()
    ? DASHBOARD_HISTORICAL_CACHE_TTL_MS
    : DASHBOARD_CURRENT_CACHE_TTL_MS;
}

function getDashboardPayloadCacheKey(startDate: string, endDate: string, sections: RequestedSections): string {
  return [
    startDate,
    endDate,
    sections.ads ? 'ads' : '',
    sections.crowd ? 'crowd' : '',
    sections.single ? 'single' : '',
  ].join('|');
}

function getCachedDashboardPayload(cacheKey: string, endDate: string): Record<string, unknown> | null {
  const cached = dashboardPayloadCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > getDashboardPayloadCacheTtlMs(endDate)) {
    dashboardPayloadCache.delete(cacheKey);
    return null;
  }
  debugLog(`[dashboard-data] payload cache hit ${cacheKey} age_ms=${Date.now() - cached.cachedAt}`);
  return structuredClone(cached.payload);
}

function setCachedDashboardPayload(cacheKey: string, payload: Record<string, unknown>): void {
  if (dashboardPayloadCache.size >= DASHBOARD_PAYLOAD_CACHE_MAX_ENTRIES) {
    const oldestKey = dashboardPayloadCache.keys().next().value;
    if (oldestKey) dashboardPayloadCache.delete(oldestKey);
  }
  dashboardPayloadCache.set(cacheKey, {
    cachedAt: Date.now(),
    payload: structuredClone(payload),
  });
}

function toNum(value: unknown): number {
  return Number.parseFloat(String(value ?? '').replace(/,/g, '')) || 0;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  return isValidDateString(normalized) ? normalized : null;
}


function parseContentRangeTotal(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const parts = contentRange.split('/');
  if (parts.length !== 2 || parts[1] === '*') return null;
  const total = Number.parseInt(parts[1], 10);
  return Number.isFinite(total) ? total : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeRestErrorBody(responseText: string): string {
  const text = String(responseText || '').trim();
  if (!text) return '';

  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const headingMatch = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const source = titleMatch?.[1] || headingMatch?.[1] || text;
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function fetchRestPageWithRetry(
  table: string,
  url: string,
  headers: HeadersInit,
): Promise<{ ok: boolean; status: number; responseText: string; contentRange: string | null }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= REST_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('timeout'), REST_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const responseText = await response.text();
      const shouldRetry = REST_TRANSIENT_STATUSES.has(response.status) && attempt < REST_MAX_ATTEMPTS;
      if (!shouldRetry) {
        return {
          ok: response.ok,
          status: response.status,
          responseText,
          contentRange: response.headers.get('content-range'),
        };
      }
    } catch (error) {
      lastError = error;
      if (attempt >= REST_MAX_ATTEMPTS) {
        break;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    await sleep(REST_RETRY_BASE_DELAY_MS * attempt);
    console.warn(`[dashboard-data] retry ${attempt + 1}/${REST_MAX_ATTEMPTS} for ${table}`);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown error');
  throw new Error(`查询表 ${table} 失败: 数据源请求异常（${message}）`);
}

async function fetchTablePage(
  table: string,
  selectColumns: string[],
  limit: number,
  offset: number,
  includeCount = false,
  options: RestQueryOptions
): Promise<{ rows: any[]; totalCount: number | null }> {
  const params = new URLSearchParams();
  params.set('select', selectColumns.join(','));
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  params.set(DATE_COLUMN, `gte.${options.rangeGte}`);
  params.append(DATE_COLUMN, `lte.${options.rangeLte}`);
  const url = `${SB_URL}/rest/v1/${table}?${params.toString()}`;
  const headers = includeCount ? { ...getSupabaseHeaders(), Prefer: 'count=exact' } : getSupabaseHeaders();
  const response = await fetchRestPageWithRetry(table, url, headers);

  if (!response.ok) {
    if (response.status === 404) return { rows: [], totalCount: 0 };
    const summary = summarizeRestErrorBody(response.responseText);
    const suffix = summary ? `（${summary}）` : '';
    throw new Error(`查询表 ${table} 失败: HTTP ${response.status}${suffix}`);
  }

  return {
    rows: response.responseText ? JSON.parse(response.responseText) : [],
    totalCount: includeCount ? parseContentRangeTotal(response.contentRange) : null,
  };
}

async function fetchTableData(table: string, selectColumns: string[], options: RestQueryOptions): Promise<any[]> {
  const allData: any[] = [];
  for (let offset = 0; ; offset += REST_PAGE_SIZE) {
    const page = await fetchTablePage(table, selectColumns, REST_PAGE_SIZE, offset, false, options);
    allData.push(...page.rows);
    if (page.rows.length < REST_PAGE_SIZE) break;
  }
  return allData;
}

async function fetchSummaryTable(table: string, selectColumns: string[], startDate: string, endDate: string): Promise<any[]> {
  const startedAt = Date.now();
  debugLog(`[dashboard-data] summary query ${table} ${DATE_COLUMN}=gte.${startDate}&${DATE_COLUMN}=lte.${endDate}`);
  const rows = await fetchTableData(table, selectColumns, { rangeGte: startDate, rangeLte: endDate });
  debugLog(`[dashboard-data] summary query ${table} rows=${rows.length} duration_ms=${Date.now() - startedAt}`);
  return rows;
}

async function fetchRoutedTables(routedTables: RoutedTable[], selectColumns: string[]): Promise<any[]> {
  if (!routedTables.length) return [];
  const results = await Promise.all(
    routedTables.map(async ({ table, dates }) => {
      const sortedDates = [...dates].sort();
      const rangeGte = sortedDates[0];
      const rangeLte = sortedDates[sortedDates.length - 1];
      const startedAt = Date.now();
      debugLog(`[dashboard-data] query ${table} ${DATE_COLUMN}=gte.${rangeGte}&${DATE_COLUMN}=lte.${rangeLte}`);
      const rows = await fetchTableData(table, selectColumns, { rangeGte, rangeLte });
      debugLog(`[dashboard-data] query ${table} rows=${rows.length} duration_ms=${Date.now() - startedAt}`);
      return rows;
    }),
  );
  return results.flat();
}

function filterByDateRange(data: any[], startDate: string, endDate: string): any[] {
  return data.filter((row) => {
    const date = parseDate(row?.[DATE_COLUMN]);
    return date !== null && date >= startDate && date <= endDate;
  });
}

function createAggregateBucket(withDates = false): AggregateBucket {
  const bucket: AggregateBucket = {
    cost: 0, amount: 0, orders: 0, views: 0, shows: 0, directAmount: 0, cart: 0, fav: 0, preOrders: 0, interactions: 0,
    finGuarantee: 0, finOffline: 0, finAgency: 0, finRedPacket: 0, finYanxuanRed: 0, taobaoOrders: 0, taobaoRefund: 0, taobaoAmount: 0,
  };
  if (withDates) bucket.dates = new Set();
  return bucket;
}

function accumulateSuperLiveRow(bucket: AggregateBucket, row: any, date?: string) {
  bucket.cost += toNum(row['花费']);
  bucket.amount += toNum(row['总成交金额']);
  bucket.orders += toNum(row['总成交笔数']);
  bucket.views += toNum(row['观看次数']);
  bucket.shows += toNum(row['展现量']);
  bucket.directAmount += toNum(row['直接成交金额']);
  bucket.cart += toNum(row['总购物车数']);
  bucket.fav += toNum(row['总收藏数']);
  bucket.preOrders += toNum(row['总预售成交笔数']);
  bucket.interactions += toNum(row['互动量']);
  if (bucket.dates && date) bucket.dates.add(date);
}

function accumulateAdsSummaryRow(bucket: AggregateBucket, row: any) {
  accumulateSuperLiveRow(bucket, row);
  bucket.finGuarantee += toNum(row['保量佣金']);
  bucket.finOffline += toNum(row['预估结算线下佣金']);
  bucket.finAgency += toNum(row['预估结算机构佣金']);
  bucket.finRedPacket += toNum(row['直播间红包']);
  bucket.finYanxuanRed += toNum(row['严选红包']);
  bucket.taobaoOrders += toNum(row['淘宝直播成交笔数']);
  bucket.taobaoAmount += toNum(row['淘宝直播成交金额']);
  bucket.taobaoRefund += toNum(row['淘宝直播退款金额']);
}

function buildAdsBucketFromSummaryRow(row: any): AggregateBucket {
  const bucket = createAggregateBucket(false);
  accumulateAdsSummaryRow(bucket, row);
  return bucket;
}

function sumRows(rows: any[], field: string): number {
  return rows.reduce((sum, row) => sum + toNum(row?.[field]), 0);
}

function buildFinByDate(financialData: any[]) {
  const result: Record<string, any> = {};
  financialData.forEach((row) => {
    const date = parseDate(row['日期']);
    if (date) result[date] = row;
  });
  return result;
}

function buildLiveByDate(taobaoData: any[]) {
  const result: Record<string, any[]> = {};
  taobaoData.forEach((row) => {
    const date = parseDate(row['日期']);
    if (!date) return;
    if (!result[date]) result[date] = [];
    result[date].push(row);
  });
  return result;
}

function mergeFinAndLiveByDates(bucket: AggregateBucket, dates: Iterable<string>, finByDate: Record<string, any>, liveByDate: Record<string, any[]>) {
  Array.from(dates).forEach((date) => {
    const finRecord = finByDate[date];
    if (finRecord) {
      bucket.finGuarantee += toNum(finRecord['保量佣金']);
      bucket.finOffline += toNum(finRecord['预估结算线下佣金']);
      bucket.finAgency += toNum(finRecord['预估结算机构佣金']);
      bucket.finRedPacket += toNum(finRecord['直播间红包']);
      bucket.finYanxuanRed += toNum(finRecord['严选红包']);
    }
    const liveRecords = liveByDate[date] || [];
    liveRecords.forEach((row) => {
      bucket.taobaoOrders += toNum(row['成交笔数']);
      bucket.taobaoRefund += toNum(row['退款金额']);
      bucket.taobaoAmount += toNum(row['成交金额']);
    });
  });
}

function getBucketFinNet(bucket: Pick<AggregateBucket, 'finGuarantee' | 'finOffline' | 'finAgency' | 'finRedPacket' | 'finYanxuanRed'>): number {
  return bucket.finGuarantee + bucket.finOffline + bucket.finAgency - bucket.finRedPacket - bucket.finYanxuanRed;
}

function isFiniteMetric(value: unknown): value is number {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function computeAdRevenue(finNet: number, orders: number, taobaoOrders: number): number | null {
  if (taobaoOrders <= 0) return null;
  return finNet * (orders / taobaoOrders);
}

function computeBreakevenRoi(adRevenue: number | null, cost: number): number | null {
  if (!isFiniteMetric(adRevenue) || cost <= 0) return null;
  return adRevenue / cost;
}

function calcGroup(row: Record<string, number>) {
  const cost = toNum(row['花费']);
  const amount = toNum(row['总成交金额']);
  const orders = toNum(row['总成交笔数']);
  const views = toNum(row['观看次数']);
  const shows = toNum(row['展现量']);
  const directAmount = toNum(row['直接成交金额']);
  const cart = toNum(row['总购物车数']);
  const fav = toNum(row['总收藏数']);
  const preOrders = toNum(row['总预售成交笔数']);
  const interactions = toNum(row['互动量']);
  return {
    cost, amount, orders, views, shows, directAmount, cart, fav, preOrders, interactions,
    roi: cost > 0 ? amount / cost : 0,
    directRoi: cost > 0 ? directAmount / cost : 0,
    viewCost: views > 0 ? cost / views : 0,
    orderCost: orders > 0 ? cost / orders : 0,
    cartCost: cart > 0 ? cost / cart : 0,
    preOrderCost: preOrders > 0 ? cost / preOrders : 0,
    viewConvertRate: views > 0 ? (orders / views) * 100 : 0,
    deepInteractRate: views > 0 ? (interactions / views) * 100 : 0,
    viewRate: shows > 0 ? (views / shows) * 100 : 0,
    cpm: shows > 0 ? (cost / shows) * 1000 : 0,
  };
}

function getWeekStr(dateString: string) {
  const [year, month, day] = dateString.split('-').map((item) => Number.parseInt(item, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNum = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-W${String(weekNum).padStart(2, '0')}`;
}

function buildAggregateDisplay(label: string, bucket: AggregateBucket): DisplayRow {
  const metrics = calcGroup({
    '花费': bucket.cost, '总成交金额': bucket.amount, '总成交笔数': bucket.orders, '观看次数': bucket.views, '展现量': bucket.shows,
    '直接成交金额': bucket.directAmount, '总购物车数': bucket.cart, '总收藏数': bucket.fav, '总预售成交笔数': bucket.preOrders, '互动量': bucket.interactions,
  });
  const finNet = getBucketFinNet(bucket);
  const adRevenue = computeAdRevenue(finNet, bucket.orders, bucket.taobaoOrders);
  return {
    label,
    ...metrics,
    finGuarantee: bucket.finGuarantee,
    finOffline: bucket.finOffline,
    finAgency: bucket.finAgency,
    finRedPacket: bucket.finRedPacket,
    finYanxuanRed: bucket.finYanxuanRed,
    taobaoOrders: bucket.taobaoOrders,
    taobaoRefund: bucket.taobaoRefund,
    taobaoAmount: bucket.taobaoAmount,
    taobaoReturnRate: bucket.taobaoAmount > 0 ? bucket.taobaoRefund / bucket.taobaoAmount : 0,
    adRevenue,
    breakevenRoi: computeBreakevenRoi(adRevenue, bucket.cost),
    returnRoi: bucket.cost > 0 ? bucket.amount * (1 - (bucket.taobaoAmount > 0 ? bucket.taobaoRefund / bucket.taobaoAmount : 0)) / bucket.cost : 0,
    adShare: bucket.taobaoOrders > 0 ? bucket.orders / bucket.taobaoOrders : 0,
    computableDays: adRevenue === null ? 0 : 1,
    skippedDays: adRevenue === null ? 1 : 0,
  };
}

function aggregateDisplayRows(label: string, rows: DisplayRow[]): DisplayRow {
  const bucket = createAggregateBucket(false);
  let adRevenue = 0;
  let computableCost = 0;
  let computableDays = 0;
  let skippedDays = 0;

  rows.forEach((row) => {
    bucket.cost += toNum(row.cost);
    bucket.amount += toNum(row.amount);
    bucket.orders += toNum(row.orders);
    bucket.views += toNum(row.views);
    bucket.shows += toNum(row.shows);
    bucket.directAmount += toNum(row.directAmount);
    bucket.cart += toNum(row.cart);
    bucket.fav += toNum(row.fav);
    bucket.preOrders += toNum(row.preOrders);
    bucket.interactions += toNum(row.interactions);
    bucket.finGuarantee += toNum(row.finGuarantee);
    bucket.finOffline += toNum(row.finOffline);
    bucket.finAgency += toNum(row.finAgency);
    bucket.finRedPacket += toNum(row.finRedPacket);
    bucket.finYanxuanRed += toNum(row.finYanxuanRed);
    bucket.taobaoOrders += toNum(row.taobaoOrders);
    bucket.taobaoRefund += toNum(row.taobaoRefund);
    bucket.taobaoAmount += toNum(row.taobaoAmount);

    if (isFiniteMetric(row.adRevenue)) {
      adRevenue += Number(row.adRevenue);
      computableCost += toNum(row.cost);
    }
    computableDays += Number(row.computableDays || 0);
    skippedDays += Number(row.skippedDays || 0);
  });

  const metrics = calcGroup({
    '花费': bucket.cost, '总成交金额': bucket.amount, '总成交笔数': bucket.orders, '观看次数': bucket.views, '展现量': bucket.shows,
    '直接成交金额': bucket.directAmount, '总购物车数': bucket.cart, '总收藏数': bucket.fav, '总预售成交笔数': bucket.preOrders, '互动量': bucket.interactions,
  });
  const totalAdRevenue = computableDays > 0 ? adRevenue : null;
  return {
    label,
    ...metrics,
    finGuarantee: bucket.finGuarantee,
    finOffline: bucket.finOffline,
    finAgency: bucket.finAgency,
    finRedPacket: bucket.finRedPacket,
    finYanxuanRed: bucket.finYanxuanRed,
    taobaoOrders: bucket.taobaoOrders,
    taobaoRefund: bucket.taobaoRefund,
    taobaoAmount: bucket.taobaoAmount,
    taobaoReturnRate: bucket.taobaoAmount > 0 ? bucket.taobaoRefund / bucket.taobaoAmount : 0,
    adRevenue: totalAdRevenue,
    breakevenRoi: computeBreakevenRoi(totalAdRevenue, computableCost),
    returnRoi: bucket.cost > 0 ? bucket.amount * (1 - (bucket.taobaoAmount > 0 ? bucket.taobaoRefund / bucket.taobaoAmount : 0)) / bucket.cost : 0,
    adShare: bucket.taobaoOrders > 0 ? bucket.orders / bucket.taobaoOrders : 0,
    computableDays,
    skippedDays,
  };
}

function buildDailyAggregateMap(rows: any[], finByDate: Record<string, any>, liveByDate: Record<string, any[]>) {
  const result: Record<string, AggregateBucket> = {};
  rows.forEach((row) => {
    const date = parseDate(row['日期']);
    if (!date) return;
    if (!result[date]) result[date] = createAggregateBucket(false);
    accumulateSuperLiveRow(result[date], row);
  });
  Object.keys(result).forEach((date) => mergeFinAndLiveByDates(result[date], [date], finByDate, liveByDate));
  return result;
}

function buildPeriodRowsFromDailyRows(dailyRows: DisplayRow[], getKey: (date: string) => string): DisplayRow[] {
  const groups: Record<string, DisplayRow[]> = {};
  dailyRows.forEach((row) => {
    const key = getKey(row.label);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });
  return Object.keys(groups).sort().reverse().map((key) => aggregateDisplayRows(key, groups[key]));
}

function buildCrowdRows(rows: any[], crowdLayerConfig: CrowdLayerConfig) {
  const crowdMap: Record<string, AggregateBucket> = {};
  const crowdSubs: Record<string, Record<string, AggregateBucket>> = {};
  rows.forEach((row) => {
    const crowd = classifyDimensionValue(String(row['人群名字'] ?? ''), crowdLayerConfig);
    const subName = String(row['人群名字'] ?? '').trim() || '未命名人群';
    if (!crowdMap[crowd]) crowdMap[crowd] = createAggregateBucket(false);
    if (!crowdSubs[crowd]) crowdSubs[crowd] = {};
    if (!crowdSubs[crowd][subName]) crowdSubs[crowd][subName] = createAggregateBucket(false);
    accumulateSuperLiveRow(crowdMap[crowd], row);
    accumulateSuperLiveRow(crowdSubs[crowd][subName], row);
  });
  return Object.keys(crowdMap)
    .sort((left, right) => crowdMap[right].cost - crowdMap[left].cost)
    .map((crowd) => ({
      crowd,
      summary: calcGroup({
        '花费': crowdMap[crowd].cost,
        '总成交金额': crowdMap[crowd].amount,
        '总成交笔数': crowdMap[crowd].orders,
        '观看次数': crowdMap[crowd].views,
        '展现量': crowdMap[crowd].shows,
        '直接成交金额': crowdMap[crowd].directAmount,
        '总购物车数': crowdMap[crowd].cart,
        '总预售成交笔数': crowdMap[crowd].preOrders,
        '互动量': crowdMap[crowd].interactions,
      }),
      subRows: Object.keys(crowdSubs[crowd])
        .sort((left, right) => crowdSubs[crowd][right].cost - crowdSubs[crowd][left].cost)
        .map((name) => ({
          label: name,
          ...calcGroup({
            '花费': crowdSubs[crowd][name].cost,
            '总成交金额': crowdSubs[crowd][name].amount,
            '总成交笔数': crowdSubs[crowd][name].orders,
            '观看次数': crowdSubs[crowd][name].views,
            '展现量': crowdSubs[crowd][name].shows,
            '直接成交金额': crowdSubs[crowd][name].directAmount,
            '总购物车数': crowdSubs[crowd][name].cart,
            '总预售成交笔数': crowdSubs[crowd][name].preOrders,
            '互动量': crowdSubs[crowd][name].interactions,
          }),
        })),
    }));
}

function buildCrowdRowsFromSummary(rows: any[], crowdLayerConfig: CrowdLayerConfig) {
  const crowdMap: Record<string, AggregateBucket> = {};
  const crowdSubs: Record<string, Record<string, AggregateBucket>> = {};

  rows.forEach((row) => {
    const subName = String(row['人群名字'] ?? '').trim() || '未命名人群';
    const crowd = String(row['人群分类'] ?? '').trim() || classifyDimensionValue(subName, crowdLayerConfig);
    if (!crowdMap[crowd]) crowdMap[crowd] = createAggregateBucket(false);
    if (!crowdSubs[crowd]) crowdSubs[crowd] = {};
    if (!crowdSubs[crowd][subName]) crowdSubs[crowd][subName] = createAggregateBucket(false);
    accumulateSuperLiveRow(crowdMap[crowd], row);
    accumulateSuperLiveRow(crowdSubs[crowd][subName], row);
  });

  return Object.keys(crowdMap)
    .sort((left, right) => crowdMap[right].cost - crowdMap[left].cost)
    .map((crowd) => ({
      crowd,
      summary: calcGroup({
        '花费': crowdMap[crowd].cost,
        '总成交金额': crowdMap[crowd].amount,
        '总成交笔数': crowdMap[crowd].orders,
        '观看次数': crowdMap[crowd].views,
        '展现量': crowdMap[crowd].shows,
        '直接成交金额': crowdMap[crowd].directAmount,
        '总购物车数': crowdMap[crowd].cart,
        '总预售成交笔数': crowdMap[crowd].preOrders,
        '互动量': crowdMap[crowd].interactions,
      }),
      subRows: Object.keys(crowdSubs[crowd])
        .sort((left, right) => crowdSubs[crowd][right].cost - crowdSubs[crowd][left].cost)
        .map((name) => ({
          label: name,
          ...calcGroup({
            '花费': crowdSubs[crowd][name].cost,
            '总成交金额': crowdSubs[crowd][name].amount,
            '总成交笔数': crowdSubs[crowd][name].orders,
            '观看次数': crowdSubs[crowd][name].views,
            '展现量': crowdSubs[crowd][name].shows,
            '直接成交金额': crowdSubs[crowd][name].directAmount,
            '总购物车数': crowdSubs[crowd][name].cart,
            '总预售成交笔数': crowdSubs[crowd][name].preOrders,
            '互动量': crowdSubs[crowd][name].interactions,
          }),
        })),
    }));
}

function buildAdsPayloadFromSummary(rows: any[]) {
  const totalAggregate = createAggregateBucket(false);
  rows.forEach((row) => accumulateAdsSummaryRow(totalAggregate, row));

  const dailyRows = rows
    .map((row) => {
      const date = parseDate(row['日期']);
      if (!date) return null;
      return buildAggregateDisplay(date, buildAdsBucketFromSummaryRow(row));
    })
    .filter((row): row is DisplayRow => Boolean(row))
    .sort((left, right) => right.label.localeCompare(left.label));

  return {
    kpi: buildKpiPayload(totalAggregate, dailyRows),
    monthly: buildPeriodRowsFromDailyRows(dailyRows, (date) => date.slice(0, 7)),
    weekly: buildPeriodRowsFromDailyRows(dailyRows, getWeekStr),
    daily: dailyRows,
  };
}

function buildKpiPayload(totalAggregate: AggregateBucket, dailyRows: DisplayRow[]) {
  const totalAdRevenue = dailyRows.reduce((sum, row) => sum + (isFiniteMetric(row.adRevenue) ? Number(row.adRevenue) : 0), 0);
  const computableCost = dailyRows.reduce((sum, row) => sum + (isFiniteMetric(row.adRevenue) ? Number(row.cost) : 0), 0);
  const computableDays = dailyRows.reduce((sum, row) => sum + Number(row.computableDays || 0), 0);
  const skippedDays = dailyRows.reduce((sum, row) => sum + Number(row.skippedDays || 0), 0);
  return {
    totalCost: totalAggregate.cost,
    totalAmount: totalAggregate.amount,
    totalOrders: totalAggregate.orders,
    avgRoi: totalAggregate.cost > 0 ? totalAggregate.amount / totalAggregate.cost : 0,
    avgDirectRoi: totalAggregate.cost > 0 ? totalAggregate.directAmount / totalAggregate.cost : 0,
    totalAdRevenue: computableDays > 0 ? totalAdRevenue : null,
    totalBreakevenRoi: computeBreakevenRoi(computableDays > 0 ? totalAdRevenue : null, computableCost),
    totalReturnRoi: totalAggregate.cost > 0 ? totalAggregate.amount * (1 - (totalAggregate.taobaoAmount > 0 ? totalAggregate.taobaoRefund / totalAggregate.taobaoAmount : 0)) / totalAggregate.cost : 0,
    totalAdShare: totalAggregate.taobaoOrders > 0 ? totalAggregate.orders / totalAggregate.taobaoOrders : 0,
    avgViewCost: totalAggregate.views > 0 ? totalAggregate.cost / totalAggregate.views : 0,
    avgOrderCost: totalAggregate.orders > 0 ? totalAggregate.cost / totalAggregate.orders : 0,
    avgCartCost: totalAggregate.cart > 0 ? totalAggregate.cost / totalAggregate.cart : 0,
    totalPreOrders: totalAggregate.preOrders,
    avgPreOrderCost: totalAggregate.preOrders > 0 ? totalAggregate.cost / totalAggregate.preOrders : 0,
    avgViewConvertRate: totalAggregate.views > 0 ? (totalAggregate.orders / totalAggregate.views) * 100 : 0,
    avgDeepInteractRate: totalAggregate.views > 0 ? (totalAggregate.interactions / totalAggregate.views) * 100 : 0,
    avgViewRate: totalAggregate.shows > 0 ? (totalAggregate.views / totalAggregate.shows) * 100 : 0,
    avgCpm: totalAggregate.shows > 0 ? (totalAggregate.cost / totalAggregate.shows) * 1000 : 0,
    totalShows: totalAggregate.shows,
    totalCart: totalAggregate.cart,
    totalDirectAmount: totalAggregate.directAmount,
    finGuarantee: totalAggregate.finGuarantee,
    finOffline: totalAggregate.finOffline,
    finAgency: totalAggregate.finAgency,
    finRedPacket: totalAggregate.finRedPacket,
    finYanxuanRed: totalAggregate.finYanxuanRed,
    totalTaobaoOrders: totalAggregate.taobaoOrders,
    totalReturnRate: totalAggregate.taobaoAmount > 0 ? totalAggregate.taobaoRefund / totalAggregate.taobaoAmount : 0,
    computableDays,
    skippedDays,
  };
}

export async function getDashboardPayload(startDate: string, endDate: string, sections: RequestedSections) {
  const cacheKey = getDashboardPayloadCacheKey(startDate, endDate, sections);
  const cachedPayload = getCachedDashboardPayload(cacheKey, endDate);
  if (cachedPayload) {
    return cachedPayload;
  }

  const dashboardSpec = await getDashboardSpec();
  const needAds = sections.ads;
  const needCrowd = sections.crowd;
  const needSingle = sections.single;

  const [adsSummaryRaw, crowdSummaryRaw, singleSummaryRaw] = await Promise.all([
    needAds ? fetchSummaryTable('dashboard_ads_daily_summary', ADS_SUMMARY_COLUMNS, startDate, endDate) : Promise.resolve([]),
    needCrowd ? fetchSummaryTable('dashboard_crowd_daily_summary', CROWD_SUMMARY_COLUMNS, startDate, endDate) : Promise.resolve([]),
    needSingle ? fetchSummaryTable('dashboard_single_product_daily_summary', SINGLE_PRODUCT_SUMMARY_COLUMNS, startDate, endDate) : Promise.resolve([]),
  ]);

  const adsSummaryData = filterByDateRange(adsSummaryRaw, startDate, endDate);
  const crowdSummaryData = filterByDateRange(crowdSummaryRaw, startDate, endDate);
  const singleSummaryData = filterByDateRange(singleSummaryRaw, startDate, endDate);
  const useAdsSummary = needAds && adsSummaryData.length > 0;
  const useCrowdSummary = needCrowd && crowdSummaryData.length > 0;
  const useSingleSummary = needSingle && singleSummaryData.length > 0;
  const needRawAds = needAds && !useAdsSummary;
  const needRawCrowd = needCrowd && !useCrowdSummary;
  const needRawSingle = needSingle && !useSingleSummary;
  const needRawSuperLive = needRawAds || needRawCrowd;
  const superLiveColumns = needRawCrowd ? SUPER_LIVE_CROWD_COLUMNS : SUPER_LIVE_BASE_COLUMNS;

  if (useAdsSummary) debugLog(`[dashboard-data] using ads summary rows=${adsSummaryData.length}`);
  if (useCrowdSummary) debugLog(`[dashboard-data] using crowd summary rows=${crowdSummaryData.length}`);
  if (useSingleSummary) debugLog(`[dashboard-data] using single summary rows=${singleSummaryData.length}`);
  if (needRawAds || needRawCrowd || needRawSingle) {
    debugLog(`[dashboard-data] summary fallback raw ads=${needRawAds} crowd=${needRawCrowd} single=${needRawSingle}`);
  }

  const [financialRaw, taobaoRaw, superLiveChunks, singleProductRaw] = await Promise.all([
    needRawAds ? fetchRoutedTables(getFinancialTablesForDateRange(startDate, endDate), FINANCIAL_COLUMNS) : Promise.resolve([]),
    needRawAds ? fetchRoutedTables(getTaobaoLiveTablesForDateRange(startDate, endDate), TAOBAO_LIVE_COLUMNS) : Promise.resolve([]),
    needRawSuperLive ? fetchRoutedTables(getSuperLiveTablesForDateRange(startDate, endDate), superLiveColumns) : Promise.resolve([]),
    needRawSingle ? fetchRoutedTables(getSingleProductAdTablesForDateRange(startDate, endDate), SINGLE_PRODUCT_COLUMNS) : Promise.resolve([]),
  ]);

  const financialData = filterByDateRange(financialRaw, startDate, endDate);
  const taobaoData = filterByDateRange(taobaoRaw, startDate, endDate);
  const superLiveFlat = Array.isArray(superLiveChunks) ? superLiveChunks.flat() : [];
  const superLiveData = filterByDateRange(superLiveFlat, startDate, endDate);
  const singleProductFilteredData = filterByDateRange(singleProductRaw, startDate, endDate);
  const singleProductData = needSingle ? dedupeSingleProductRows(singleProductFilteredData) : singleProductFilteredData;

  const payload: Record<string, unknown> = {
    spec: { version: dashboardSpec.version, docsSource: dashboardSpec.docsSource },
    range: { start: startDate, end: endDate },
    sources: {
      ads: useAdsSummary ? 'summary' : needAds ? 'raw' : 'skipped',
      crowd: useCrowdSummary ? 'summary' : needCrowd ? 'raw' : 'skipped',
      single: useSingleSummary ? 'summary' : needSingle ? 'raw' : 'skipped',
    },
    counts: {
      financial: useAdsSummary ? sumRows(adsSummaryData, 'source_financial_rows') : financialData.length,
      taobaoLive: useAdsSummary ? sumRows(adsSummaryData, 'source_taobao_rows') : taobaoData.length,
      superLive: useAdsSummary ? sumRows(adsSummaryData, 'source_super_live_rows') : useCrowdSummary ? sumRows(crowdSummaryData, 'source_row_count') : superLiveData.length,
      singleProduct: useSingleSummary ? sumRows(singleSummaryData, 'source_row_count') : singleProductData.length,
    },
  };

  if (needAds) {
    if (useAdsSummary) {
      payload.ads = buildAdsPayloadFromSummary(adsSummaryData);
    } else {
      const finByDate = buildFinByDate(financialData);
      const liveByDate = buildLiveByDate(taobaoData);
      const totalAggregate = createAggregateBucket(true);
      superLiveData.forEach((row) => {
        const date = parseDate(row['日期']);
        if (!date) return;
        accumulateSuperLiveRow(totalAggregate, row, date);
      });
      mergeFinAndLiveByDates(totalAggregate, totalAggregate.dates || [], finByDate, liveByDate);
      const dailyMap = buildDailyAggregateMap(superLiveData, finByDate, liveByDate);
      const dailyRows = Object.keys(dailyMap).sort().reverse().map((key) => buildAggregateDisplay(key, dailyMap[key]));

      payload.ads = {
        kpi: buildKpiPayload(totalAggregate, dailyRows),
        monthly: buildPeriodRowsFromDailyRows(dailyRows, (date) => date.slice(0, 7)),
        weekly: buildPeriodRowsFromDailyRows(dailyRows, getWeekStr),
        daily: dailyRows,
      };
    }
  }

  if (needCrowd) {
    payload.crowd = {
      summary: useCrowdSummary
        ? buildCrowdRowsFromSummary(crowdSummaryData, dashboardSpec.dimensions.crowdLayer)
        : buildCrowdRows(superLiveData, dashboardSpec.dimensions.crowdLayer),
    };
  }

  if (needSingle) {
    const singleRows = useSingleSummary ? singleSummaryData : singleProductData;
    const singleItems = aggregateSingleByProduct(singleRows);
    payload.single = {
      kpi: buildSingleKpiPayload(singleRows, singleItems),
      items: singleItems,
      exportRows: singleRows,
      rawSourceRowCount: useSingleSummary ? sumRows(singleSummaryData, 'source_row_count') : singleProductFilteredData.length,
    };
  }

  setCachedDashboardPayload(cacheKey, payload);
  return payload;
}

export { isValidDateString, type RequestedSections };
