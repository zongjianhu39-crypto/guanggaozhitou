import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';
import { getSuperLiveTablesForDates } from '../_shared/table-routes.ts';
import { createErrorResponse } from '../_shared/error-handler.ts';
import {
  DATA_SOURCE_CONFIG,
  buildPlanDashboardSummary,
  enumerateDates,
  getReferenceDates,
  isValidDate,
  normalizePlanPatch,
  toNum,
} from '../_shared/plan-dashboard-core.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
const DATE_FILTERS_PER_REQUEST = 45;

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function actorLabel(authResult: Awaited<ReturnType<typeof authenticateEdgeRequest>> | null, fallback = 'unknown') {
  if (!authResult) return fallback;
  if (authResult.type === 'prompt_admin') {
    return String(authResult.payload?.sub || authResult.payload?.user_id || fallback);
  }
  return String(authResult.user?.email || authResult.user?.id || fallback);
}


function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
  const pageSize = 1000;

  for (const chunk of chunkArray(normalizedDates, DATE_FILTERS_PER_REQUEST)) {
    let from = 0;
    while (true) {
      const { data, error } = await client
        .from(table)
        .select(select)
        .in(dateField, chunk)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`读取表 ${table} 失败: ${error.message}`);
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
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
  const pageSize = 1000;
  let from = 0;
  const rows: Record<string, unknown>[] = [];
  while (true) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .gte(dateField, start)
      .lte(dateField, end)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`读取表 ${table} 失败: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
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
    amountColumn,
    viewsColumn,
    ordersColumn,
    cartColumn,
    preOrdersColumn,
  } = DATA_SOURCE_CONFIG.superLive;
  const chunks = await Promise.all(
    routedTables.map(({ table, dates: routedDates }) => {
      const dateField = getSuperLiveDateColumn(table);
      return fetchRowsByDateFilters(
        client,
        table,
        `${dateField},${amountColumn},${viewsColumn},${ordersColumn},${cartColumn},${preOrdersColumn}`,
        dateField,
        routedDates,
      );
    }),
  );
  return chunks.flat();
}

function toDatetime(date: string, time: string | null | undefined): string {
  return `${date}T${time || '00:00'}`;
}

async function findOverlappingActivities(
  client: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  excludeId?: string,
) {
  // Fetch date-level candidates first (superset), then filter by minute precision
  let query = client
    .from(DATA_SOURCE_CONFIG.tables.activities)
    .select('id,activity_name,start_date,end_date,start_time,end_time')
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .order('start_date', { ascending: true });
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw new Error(`读取活动冲突失败: ${error.message}`);
  if (!data?.length) return [];

  const newStart = toDatetime(startDate, startTime);
  const newEnd = toDatetime(endDate, endTime || '23:59');
  return data.filter((existing) => {
    const exStart = toDatetime(String(existing.start_date), existing.start_time);
    const exEnd = toDatetime(String(existing.end_date), existing.end_time || '23:59');
    return newStart < exEnd && newEnd > exStart;
  });
}

async function handleGet(req: Request, client: ReturnType<typeof createClient>, headers: Record<string, string>) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!isValidDate(start) || !isValidDate(end)) {
    return json({ error: '缺少或非法的 start/end，要求 YYYY-MM-DD' }, 400, headers);
  }
  if (start! > end!) {
    return json({ error: 'start 不能大于 end' }, 400, headers);
  }

  const dates = enumerateDates(start!, end!);
  const referenceDates = getReferenceDates(dates);

  const [plansRes, activitiesRes, wanxiangRows, agentRows, referenceAgentRows, shortLiveLinkRows, referenceRows, referenceFinancialRows, referenceTaobaoLiveRows] = await Promise.all([
    client.from(DATA_SOURCE_CONFIG.tables.plans).select('*').gte('plan_date', start!).lte('plan_date', end!),
    client
      .from(DATA_SOURCE_CONFIG.tables.activities)
      .select('*')
      .lte('start_date', end!)
      .gte('end_date', start!)
      .order('start_date', { ascending: true }),
    fetchSuperLiveRowsForDates(client, dates),
    fetchRowsByDateRange(
      client,
      DATA_SOURCE_CONFIG.tables.agentActual,
      DATA_SOURCE_CONFIG.agentActual.select,
      DATA_SOURCE_CONFIG.agentActual.dateColumn,
      start!,
      end!,
    ),
    fetchRowsByDateFilters(
      client,
      DATA_SOURCE_CONFIG.tables.agentActual,
      DATA_SOURCE_CONFIG.agentActual.select,
      DATA_SOURCE_CONFIG.agentActual.dateColumn,
      referenceDates,
    ),
    fetchRowsByDateRange(
      client,
      DATA_SOURCE_CONFIG.tables.shortLiveLink,
      DATA_SOURCE_CONFIG.shortLiveLink.select,
      DATA_SOURCE_CONFIG.shortLiveLink.dateColumn,
      start!,
      end!,
    ),
    fetchSuperLiveRowsForDates(client, referenceDates),
    fetchRowsByDateFilters(
      client,
      DATA_SOURCE_CONFIG.tables.referenceFinancial,
      DATA_SOURCE_CONFIG.referenceFinancial.select,
      DATA_SOURCE_CONFIG.referenceFinancial.dateColumn,
      referenceDates,
    ),
    fetchRowsByDateFilters(
      client,
      DATA_SOURCE_CONFIG.tables.referenceTaobaoLive,
      DATA_SOURCE_CONFIG.referenceTaobaoLive.select,
      DATA_SOURCE_CONFIG.referenceTaobaoLive.dateColumn,
      referenceDates,
    ),
  ]);

  if (plansRes.error) return json({ error: `读取 ${DATA_SOURCE_CONFIG.tables.plans} 失败: ${plansRes.error.message}` }, 500, headers);
  if (activitiesRes.error) return json({ error: `读取 ${DATA_SOURCE_CONFIG.tables.activities} 失败: ${activitiesRes.error.message}` }, 500, headers);

  const summary = buildPlanDashboardSummary({
    start: start!,
    end: end!,
    plans: plansRes.data ?? [],
    activities: activitiesRes.data ?? [],
    wanxiangRows,
    agentRows,
    referenceAgentRows,
    shortLiveLinkRows,
    referenceRows,
    referenceFinancialRows,
    referenceTaobaoLiveRows,
  });

  return json(summary, 200, headers);
}

async function handlePost(req: Request, client: ReturnType<typeof createClient>, headers: Record<string, string>, authResult: Awaited<ReturnType<typeof authenticateEdgeRequest>>) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: '请求体不是合法 JSON' }, 400, headers);
  const action = String(body.action || '');
  const updatedBy = actorLabel(authResult);

  if (action === 'save_plan') {
    const date = String(body.date || '');
    const patch = (body.patch && typeof body.patch === 'object') ? body.patch as Record<string, unknown> : {};
    if (!isValidDate(date)) return json({ error: 'date 非法' }, 400, headers);
    const payload: Record<string, unknown> = { plan_date: date, updated_by: updatedBy, ...normalizePlanPatch(patch) };
    const { error } = await client.from(DATA_SOURCE_CONFIG.tables.plans).upsert(payload, { onConflict: 'plan_date' });
    if (error) return json({ error: error.message }, 500, headers);
    return json({ success: true }, 200, headers);
  }

  if (action === 'save_plans') {
    const items = Array.isArray(body.items) ? body.items : [];
    const normalizedItems = items.map((item) => {
      const entry = item as Record<string, unknown>;
      const patch = (entry.patch && typeof entry.patch === 'object') ? entry.patch as Record<string, unknown> : {};
      return {
        plan_date: String(entry.date || ''),
        patch: normalizePlanPatch(patch),
      };
    }).filter((item) => isValidDate(item.plan_date) && Object.keys(item.patch).length > 0);

    if (!normalizedItems.length) {
      return json({ success: true, count: 0 }, 200, headers);
    }

    const dates = [...new Set(normalizedItems.map((item) => item.plan_date))];
    const { data: existingRows, error: existingError } = await client
      .from(DATA_SOURCE_CONFIG.tables.plans)
      .select('plan_date,wanxiang_plan,agent_plan,activity_override,remark')
      .in('plan_date', dates);
    if (existingError) return json({ error: existingError.message }, 500, headers);

    const existingByDate = new Map((existingRows ?? []).map((row) => [String(row.plan_date), row as Record<string, unknown>]));
    const rows = normalizedItems.map(({ plan_date, patch }) => {
      const existing = existingByDate.get(plan_date) || {};
      return {
        plan_date,
        wanxiang_plan: 'wanxiang_plan' in patch ? patch.wanxiang_plan : toNum(existing.wanxiang_plan),
        agent_plan: 'agent_plan' in patch ? patch.agent_plan : toNum(existing.agent_plan),
        activity_override: 'activity_override' in patch ? patch.activity_override : (existing.activity_override ?? null),
        remark: 'remark' in patch ? patch.remark : (existing.remark ?? null),
        updated_by: updatedBy,
      };
    });

    const { error } = await client.from(DATA_SOURCE_CONFIG.tables.plans).upsert(rows, { onConflict: 'plan_date' });
    if (error) return json({ error: error.message }, 500, headers);
    return json({ success: true, count: rows.length }, 200, headers);
  }

  if (action === 'save_activity') {
    const payload = (body.payload && typeof body.payload === 'object') ? body.payload as Record<string, unknown> : null;
    if (!payload) return json({ error: '缺少 payload' }, 400, headers);
    const row: Record<string, unknown> = {
      id: payload.id || undefined,
      activity_name: String(payload.activity_name || '').trim(),
      activity_type: String(payload.activity_type || 'daily'),
      start_date: String(payload.start_date || ''),
      end_date: String(payload.end_date || ''),
      description: String(payload.description || '').trim(),
      start_time: payload.start_time ? String(payload.start_time).trim() : null,
      end_time: payload.end_time ? String(payload.end_time).trim() : null,
      key_sessions: payload.key_sessions ? String(payload.key_sessions).trim() : null,
      operations_action: payload.operations_action ? String(payload.operations_action).trim() : null,
      updated_by: updatedBy,
    };
    if (!row.activity_name || !isValidDate(row.start_date as string) || !isValidDate(row.end_date as string)) {
      return json({ error: '活动名称或日期非法' }, 400, headers);
    }
    if ((row.start_date as string) > (row.end_date as string)) {
      return json({ error: '开始日期不能晚于结束日期' }, 400, headers);
    }
    const overlaps = await findOverlappingActivities(
      client,
      row.start_date as string,
      row.end_date as string,
      row.start_time as string | null,
      row.end_time as string | null,
      row.id ? String(row.id) : undefined,
    );
    if (overlaps.length) {
      const conflict = overlaps[0] as Record<string, unknown>;
      return json({
        error: `活动时间与现有活动冲突：${String(conflict.activity_name || '未命名活动')}（${String(conflict.start_date || '')} ~ ${String(conflict.end_date || '')}）`,
      }, 409, headers);
    }
    const { error } = await client.from(DATA_SOURCE_CONFIG.tables.activities).upsert(row);
    if (error) return json({ error: error.message }, 500, headers);
    return json({ success: true }, 200, headers);
  }

  if (action === 'delete_activity') {
    const id = String(body.id || '');
    if (!id) return json({ error: '缺少活动 id' }, 400, headers);
    const { error } = await client.from(DATA_SOURCE_CONFIG.tables.activities).delete().eq('id', id);
    if (error) return json({ error: error.message }, 500, headers);
    return json({ success: true }, 200, headers);
  }

  if (action === 'fetch_month_note') {
    const year = Number(body.year);
    const month = Number(body.month);
    const noteType = String(body.note_type || 'rhythm_summary_note');
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return json({ error: 'year/month 非法' }, 400, headers);
    }
    const { data, error } = await client
      .from('ad_plan_month_notes')
      .select('content,updated_at,updated_by')
      .eq('year', year)
      .eq('month', month)
      .eq('note_type', noteType)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500, headers);
    return json({ note: data || null }, 200, headers);
  }

  if (action === 'save_month_note') {
    const year = Number(body.year);
    const month = Number(body.month);
    const noteType = String(body.note_type || 'rhythm_summary_note');
    const content = String(body.content ?? '');
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return json({ error: 'year/month 非法' }, 400, headers);
    }
    const { error } = await client.from('ad_plan_month_notes').upsert(
      { year, month, note_type: noteType, content },
      { onConflict: 'year,month,note_type' },
    );
    if (error) return json({ error: error.message }, 500, headers);
    return json({ success: true }, 200, headers);
  }

  return json({ error: '不支持的 action' }, 400, headers);
}

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ error: '缺少 Supabase 环境变量' }, 500, headers);

  const authResult = await authenticateEdgeRequest(req, { allowPromptAdmin: true, allowSupabaseUser: true });
  if (!authResult) return json({ error: '未登录' }, 401, headers);

  const client = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
  try {
    if (req.method === 'GET') return await handleGet(req, client, headers);
    if (req.method === 'POST') return await handlePost(req, client, headers, authResult);
    return json({ error: '仅支持 GET / POST / OPTIONS' }, 405, headers);
  } catch (error) {
    return createErrorResponse(error, 'plan-dashboard-summary');
  }
});
