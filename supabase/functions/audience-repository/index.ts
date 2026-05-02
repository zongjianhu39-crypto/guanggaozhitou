import { createClient } from 'npm:@supabase/supabase-js@2';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';
import { createErrorResponseWithStatus } from '../_shared/error-handler.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
const MAX_IMPORT_ROWS = 500;
const MAX_METRICS = 20000;

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

function toNullableText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function toBigintLike(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function toDate(value: unknown) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toJsonObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toShare(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text.replace('%', '').replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return text.includes('%') ? numeric / 100 : numeric;
}

function normalizeAudience(item: Record<string, unknown>, updatedBy: string) {
  const audienceId = toBigintLike(item.audience_id);
  const audienceName = toNullableText(item.audience_name);
  if (!audienceId || !audienceName) return null;
  return {
    audience_id: audienceId,
    audience_name: audienceName,
    valid_from: toDate(item.valid_from),
    valid_to: toDate(item.valid_to),
    valid_range_text: toNullableText(item.valid_range_text),
    audience_size: toBigintLike(item.audience_size),
    selection_logic: toNullableText(item.selection_logic),
    audience_definition: toNullableText(item.audience_definition),
    image_formula_map: toJsonObject(item.image_formula_map),
    metric_summary: toJsonObject(item.metric_summary),
    raw_row: toJsonObject(item.raw_row),
    source_filename: toNullableText(item.source_filename),
    updated_by: updatedBy,
  };
}

function normalizeMetric(item: Record<string, unknown>) {
  const audienceId = toBigintLike(item.audience_id);
  const dimension = toNullableText(item.dimension);
  const category = toNullableText(item.category);
  if (!audienceId || !dimension || !category) return null;
  const share = toShare(item.share);
  return {
    audience_id: audienceId,
    dimension,
    category,
    share,
    share_text: toNullableText(item.share_text),
    source: toNullableText(item.source) || 'image_extract',
  };
}

async function handleGet(req: Request, client: ReturnType<typeof createClient>, headers: Record<string, string>) {
  const url = new URL(req.url);
  const q = String(url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);

  let query = client
    .from('audience_repository')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (q) {
    query = query.or(`audience_name.ilike.%${q}%,selection_logic.ilike.%${q}%,audience_definition.ilike.%${q}%`);
  }

  const { data: audiences, error } = await query;
  if (error) return json({ error: error.message }, 500, headers);

  const ids = (audiences ?? []).map((row: Record<string, unknown>) => row.audience_id).filter(Boolean);
  let metrics: Record<string, unknown>[] = [];
  if (ids.length) {
    const metricsRes = await client
      .from('audience_repository_metrics')
      .select('audience_id,dimension,category,share,share_text,source,updated_at')
      .in('audience_id', ids)
      .order('dimension', { ascending: true })
      .order('category', { ascending: true });
    if (metricsRes.error) return json({ error: metricsRes.error.message }, 500, headers);
    metrics = metricsRes.data ?? [];
  }

  return json({ audiences: audiences ?? [], metrics }, 200, headers);
}

async function handleImport(
  body: Record<string, unknown>,
  client: ReturnType<typeof createClient>,
  headers: Record<string, string>,
  updatedBy: string,
) {
  const audienceItems = Array.isArray(body.audiences) ? body.audiences as Record<string, unknown>[] : [];
  const metricItems = Array.isArray(body.metrics) ? body.metrics as Record<string, unknown>[] : [];
  if (!audienceItems.length) return json({ error: '缺少可导入的人群数据' }, 400, headers);
  if (audienceItems.length > MAX_IMPORT_ROWS) return json({ error: `单次最多导入 ${MAX_IMPORT_ROWS} 条人群` }, 400, headers);
  if (metricItems.length > MAX_METRICS) return json({ error: `单次最多导入 ${MAX_METRICS} 条维度数据` }, 400, headers);

  const audiences = audienceItems
    .map((item) => normalizeAudience(item, updatedBy))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!audiences.length) return json({ error: '没有合法的人群 ID 和名称' }, 400, headers);

  const ids = Array.from(new Set(audiences.map((item) => item.audience_id)));
  const metrics = metricItems
    .map((item) => normalizeMetric(item))
    .filter((item): item is NonNullable<typeof item> => Boolean(item) && ids.includes(item.audience_id));

  const { error: audienceError } = await client
    .from('audience_repository')
    .upsert(audiences, { onConflict: 'audience_id' });
  if (audienceError) return json({ error: audienceError.message }, 500, headers);

  const { error: deleteError } = await client
    .from('audience_repository_metrics')
    .delete()
    .in('audience_id', ids);
  if (deleteError) return json({ error: deleteError.message }, 500, headers);

  if (metrics.length) {
    const { error: metricsError } = await client
      .from('audience_repository_metrics')
      .upsert(metrics, { onConflict: 'audience_id,dimension,category' });
    if (metricsError) return json({ error: metricsError.message }, 500, headers);
  }

  return json({ success: true, audience_count: audiences.length, metric_count: metrics.length }, 200, headers);
}

async function handleDelete(body: Record<string, unknown>, client: ReturnType<typeof createClient>, headers: Record<string, string>) {
  const audienceId = toBigintLike(body.audience_id);
  if (!audienceId) return json({ error: '缺少 audience_id' }, 400, headers);
  const { error } = await client.from('audience_repository').delete().eq('audience_id', audienceId);
  if (error) return json({ error: error.message }, 500, headers);
  return json({ success: true }, 200, headers);
}

async function handlePost(
  req: Request,
  client: ReturnType<typeof createClient>,
  headers: Record<string, string>,
  authResult: Awaited<ReturnType<typeof authenticateEdgeRequest>>,
) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: '请求体不是合法 JSON' }, 400, headers);
  const action = String(body.action || '');
  const updatedBy = actorLabel(authResult);
  if (action === 'import') return await handleImport(body, client, headers, updatedBy);
  if (action === 'delete') return await handleDelete(body, client, headers);
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
    return createErrorResponseWithStatus(error, 'audience-repository', 500, headers);
  }
});
