import {
  getDashboardPayload as getSharedDashboardPayload,
  isValidDateString,
} from '../_shared/dashboard-payload.ts';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';
import { createErrorResponse } from '../_shared/error-handler.ts';
import {
  buildPlanDashboardSummary,
  DATA_SOURCE_CONFIG,
  enumerateDates,
  getReferenceDates,
} from '../_shared/plan-dashboard-core.ts';
import { getSuperLiveTablesForDates } from '../_shared/table-routes.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { debugLog } from '../_shared/logger.ts';

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function getShanghaiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── plan-dashboard-summary 查询复用（精简版，仅 GET 逻辑）──

const PAGE_SIZE = 1000;
const DATE_FILTERS_PER_REQUEST = 45;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isMissingOptionalTableError(error: { code?: string; message?: string; details?: string } | null) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''} ${error.details || ''}`.toLowerCase();
  return text.includes('pgrst205')
    || text.includes('42p01')
    || text.includes('could not find the table')
    || (text.includes('relation') && text.includes('does not exist'));
}

async function fetchRowsByDateFilters(
  client: ReturnType<typeof createClient>,
  table: string,
  select: string,
  dateField: string,
  dates: string[],
) {
  const normalizedDates = Array.from(new Set(dates));
  const rows: Record<string, unknown>[] = [];
  for (const chunk of chunkArray(normalizedDates, DATE_FILTERS_PER_REQUEST)) {
    const first = await client
      .from(table)
      .select(select, { count: 'exact' })
      .in(dateField, chunk)
      .range(0, PAGE_SIZE - 1);
    if (first.error) {
      if (isMissingOptionalTableError(first.error)) return [];
      throw new Error(`读取表 ${table} 失败: ${first.error.message}`);
    }
    if (first.data?.length) rows.push(...first.data);
    const total = first.count;
    if (typeof total === 'number' && total > PAGE_SIZE) {
      const pagePromises: Promise<Record<string, unknown>[]>[] = [];
      for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
        pagePromises.push(
          client.from(table).select(select).in(dateField, chunk).range(from, from + PAGE_SIZE - 1)
            .then(({ data, error }) => {
              if (error) throw new Error(`读取表 ${table} 失败: ${error.message}`);
              return (data || []) as Record<string, unknown>[];
            }),
        );
      }
      const pages = await Promise.all(pagePromises);
      for (const page of pages) rows.push(...page);
    }
  }
  return rows;
}

async function fetchRowsByDateRange(
  client: ReturnType<typeof createClient>,
  table: string,
  select: string,
  dateField: string,
  start: string,
  end: string,
) {
  const rows: Record<string, unknown>[] = [];
  const first = await client
    .from(table)
    .select(select, { count: 'exact' })
    .gte(dateField, start)
    .lte(dateField, end)
    .range(0, PAGE_SIZE - 1);
  if (first.error) {
    if (isMissingOptionalTableError(first.error)) return [];
    throw new Error(`读取表 ${table} 失败: ${first.error.message}`);
  }
  if (first.data?.length) rows.push(...first.data);
  const total = first.count;
  if (typeof total === 'number' && total > PAGE_SIZE) {
    const pagePromises: Promise<Record<string, unknown>[]>[] = [];
    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
      pagePromises.push(
        client.from(table).select(select).gte(dateField, start).lte(dateField, end).range(from, from + PAGE_SIZE - 1)
          .then(({ data, error }) => {
            if (error) throw new Error(`读取表 ${table} 失败: ${error.message}`);
            return (data || []) as Record<string, unknown>[];
          }),
      );
    }
    const pages = await Promise.all(pagePromises);
    for (const page of pages) rows.push(...page);
  }
  return rows;
}

function getSuperLiveDateColumn(table: string) {
  return /^super_live_\d{4}$/.test(table)
    ? DATA_SOURCE_CONFIG.superLive.annualDateColumn
    : DATA_SOURCE_CONFIG.superLive.monthlyDateColumn;
}

async function fetchSuperLiveRowsForDates(client: ReturnType<typeof createClient>, dates: string[]) {
  const routedTables = getSuperLiveTablesForDates(dates);
  const {
    amountColumn, viewsColumn, ordersColumn, directOrdersColumn,
    cartColumn, preOrdersColumn, directPreOrdersColumn,
  } = DATA_SOURCE_CONFIG.superLive;
  const chunks = await Promise.all(
    routedTables.map(({ table, dates: routedDates }) => {
      const dateField = getSuperLiveDateColumn(table);
      return fetchRowsByDateFilters(
        client, table,
        `${dateField},${amountColumn},${viewsColumn},${ordersColumn},${directOrdersColumn},${cartColumn},${preOrdersColumn},${directPreOrdersColumn}`,
        dateField, routedDates,
      );
    }),
  );
  return chunks.flat();
}

async function fetchPlanSummary(
  client: ReturnType<typeof createClient>,
  start: string,
  end: string,
) {
  const dates = enumerateDates(start, end);
  const referenceDates = getReferenceDates(dates);

  const [plansRes, activitiesRes, wanxiangRows, agentRows, referenceAgentRows, shortLiveLinkRows, referenceRows, referenceFinancialRows, referenceTaobaoLiveRows] = await Promise.all([
    client.from(DATA_SOURCE_CONFIG.tables.plans).select('*').gte('plan_date', start).lte('plan_date', end),
    client.from(DATA_SOURCE_CONFIG.tables.activities).select('*').lte('start_date', end).gte('end_date', start).order('start_date', { ascending: true }),
    fetchSuperLiveRowsForDates(client, dates),
    fetchRowsByDateRange(client, DATA_SOURCE_CONFIG.tables.agentActual, DATA_SOURCE_CONFIG.agentActual.select, DATA_SOURCE_CONFIG.agentActual.dateColumn, start, end),
    fetchRowsByDateFilters(client, DATA_SOURCE_CONFIG.tables.agentActual, DATA_SOURCE_CONFIG.agentActual.select, DATA_SOURCE_CONFIG.agentActual.dateColumn, referenceDates),
    fetchRowsByDateRange(client, DATA_SOURCE_CONFIG.tables.shortLiveLink, DATA_SOURCE_CONFIG.shortLiveLink.select, DATA_SOURCE_CONFIG.shortLiveLink.dateColumn, start, end),
    fetchSuperLiveRowsForDates(client, referenceDates),
    fetchRowsByDateFilters(client, DATA_SOURCE_CONFIG.tables.referenceFinancial, DATA_SOURCE_CONFIG.referenceFinancial.select, DATA_SOURCE_CONFIG.referenceFinancial.dateColumn, referenceDates),
    fetchRowsByDateFilters(client, DATA_SOURCE_CONFIG.tables.referenceTaobaoLive, DATA_SOURCE_CONFIG.referenceTaobaoLive.select, DATA_SOURCE_CONFIG.referenceTaobaoLive.dateColumn, referenceDates),
  ]);

  if (plansRes.error) throw new Error(`读取 ${DATA_SOURCE_CONFIG.tables.plans} 失败: ${plansRes.error.message}`);
  if (activitiesRes.error) throw new Error(`读取 ${DATA_SOURCE_CONFIG.tables.activities} 失败: ${activitiesRes.error.message}`);

  return buildPlanDashboardSummary({
    start, end,
    plans: plansRes.data ?? [],
    activities: activitiesRes.data ?? [],
    wanxiangRows, agentRows, referenceAgentRows, shortLiveLinkRows,
    referenceRows, referenceFinancialRows, referenceTaobaoLiveRows,
  });
}

// ── 进程内缓存 ──

type CacheEntry = { cachedAt: number; payload: unknown };
const RESULT_CACHE = new Map<string, CacheEntry>();
const RESULT_CACHE_MAX = 20;
const RESULT_CACHE_TTL_MS = 60 * 1000;

function getCached(key: string): unknown | null {
  const hit = RESULT_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > RESULT_CACHE_TTL_MS) {
    RESULT_CACHE.delete(key);
    return null;
  }
  return hit.payload;
}

function setCache(key: string, payload: unknown): void {
  if (RESULT_CACHE.size >= RESULT_CACHE_MAX) {
    const oldest = RESULT_CACHE.keys().next().value;
    if (oldest !== undefined) RESULT_CACHE.delete(oldest);
  }
  RESULT_CACHE.set(key, { cachedAt: Date.now(), payload });
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: '仅支持 GET 请求' }), { status: 405, headers: corsHeaders });
  }

  try {
    const authResult = await authenticateEdgeRequest(req, { allowPromptAdmin: true, allowSupabaseUser: true });
    if (!authResult) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: corsHeaders });
    }
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'Supabase 环境变量缺失' }), { status: 500, headers: corsHeaders });
    }

    const requestUrl = new URL(req.url);
    const today = requestUrl.searchParams.get('today') || getShanghaiToday();
    if (!isValidDateString(today)) {
      return new Response(JSON.stringify({ error: 'today 格式错误' }), { status: 400, headers: corsHeaders });
    }

    const yoyMonth = requestUrl.searchParams.get('yoy_month') || '05';

    const cacheKey = `${today}|${yoyMonth}`;
    const cached = getCached(cacheKey);
    if (cached) {
      debugLog(`[home-data] cache hit ${cacheKey}`);
      return new Response(JSON.stringify(cached), { status: 200, headers: corsHeaders });
    }

    const startedAt = Date.now();

    // 计算所有日期区间（与前端 fetchFreshData 逻辑一致）
    const curYear = today.slice(0, 4);
    const refYear = String(Number(curYear) - 1);
    let prevMonth = Number(today.slice(5, 7)) - 1;
    let prevYear = Number(curYear);
    if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }
    const windowStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
    const yoyCurStart = `${curYear}-${yoyMonth}-01`;
    const yoyRefStart = `${refYear}-${yoyMonth}-01`;
    const yoyRefEnd = `${refYear}-${today.slice(5)}`;
    const canReuseMainForYoy = windowStart === yoyCurStart;

    const client = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

    // 所有数据并行拉取
    const fetchPromises: Promise<unknown>[] = [
      /* 0: main ads */ getSharedDashboardPayload(windowStart, today, { ads: true, crowd: false, single: false }),
      /* 1: plan */ fetchPlanSummary(client, windowStart, today).catch((e) => ({ error: String(e?.message || e) })),
      /* 2: yoy ref */ getSharedDashboardPayload(yoyRefStart, yoyRefEnd, { ads: true, crowd: false, single: false }).catch((e) => ({ error: String(e?.message || e) })),
      /* 3: crowd rule */ getSharedDashboardPayload(windowStart, today, { ads: false, crowd: true, single: false }, { crowdPlanNameIncludes: '规则' }).catch((e) => ({ error: String(e?.message || e) })),
    ];
    if (!canReuseMainForYoy) {
      fetchPromises.push(
        /* 4: yoy cur */ getSharedDashboardPayload(yoyCurStart, today, { ads: true, crowd: false, single: false }).catch((e) => ({ error: String(e?.message || e) })),
      );
    }

    const results = await Promise.all(fetchPromises);

    const mainAds = results[0] as Record<string, unknown>;
    const planData = results[1] as Record<string, unknown>;
    const yoyRef = results[2] as Record<string, unknown>;
    const crowdRule = results[3] as Record<string, unknown>;
    const yoyCur = canReuseMainForYoy ? mainAds : (results[4] as Record<string, unknown>);

    const payload = {
      success: true,
      main: mainAds,
      plan: planData,
      yoyRef,
      yoyCur,
      crowdRule,
      meta: {
        today,
        windowStart,
        yoyCurStart,
        yoyRefStart,
        yoyRefEnd,
        canReuseMainForYoy,
        durationMs: Date.now() - startedAt,
      },
    };

    setCache(cacheKey, payload);
    debugLog(`[home-data] built in ${Date.now() - startedAt}ms`);

    return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
  } catch (error) {
    return createErrorResponse(error, 'dashboard-data');
  }
});
