import { createClient } from 'npm:@supabase/supabase-js@2';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';
import { createErrorResponseWithStatus } from '../_shared/error-handler.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
const MAX_IMPORT_ROWS = 500;
const MAX_METRICS = 20000;
const MAX_PARSE_IMAGES = 10;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';

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

function extractResponseText(result: Record<string, unknown>) {
  const direct = String(result.output_text || '').trim();
  if (direct) return direct;

  const output = Array.isArray(result.output) ? result.output as Record<string, unknown>[] : [];
  const chunks: string[] = [];
  output.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content as Record<string, unknown>[] : [];
    content.forEach((part) => {
      const text = String(part.text || '').trim();
      if (text) chunks.push(text);
    });
  });
  return chunks.join('\n').trim();
}

function parseJsonFromText(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('AI 返回内容不是合法 JSON');
  }
}

function normalizeParsedMetrics(audienceId: number, parsed: unknown) {
  const body = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const items = Array.isArray(body.metrics) ? body.metrics as Record<string, unknown>[] : [];
  return items
    .map((item) => normalizeMetric({
      audience_id: audienceId,
      dimension: item.dimension,
      category: item.category,
      share: item.share,
      share_text: item.share_text,
      source: 'ai_image_extract',
    }))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function handleParseImages(body: Record<string, unknown>, headers: Record<string, string>) {
  if (!OPENAI_API_KEY) {
    return json({ error: '缺少 OPENAI_API_KEY，无法使用 AI 解析图片' }, 500, headers);
  }

  const audienceId = toBigintLike(body.audience_id);
  const images = Array.isArray(body.images) ? body.images as Record<string, unknown>[] : [];
  if (!audienceId) return json({ error: '缺少 audience_id' }, 400, headers);
  if (!images.length) return json({ error: '请至少上传一张图片' }, 400, headers);
  if (images.length > MAX_PARSE_IMAGES) return json({ error: `单次最多解析 ${MAX_PARSE_IMAGES} 张图片` }, 400, headers);

  const content: Record<string, unknown>[] = [{
    type: 'input_text',
    text: [
      '你是电商广告人群画像图片的数据抽取助手。',
      '任务：从上传的中文截图中抽取所有可见的分类占比，输出 JSON。',
      '每张图片会在前一段文字里标明维度名称。请使用该维度名称作为 dimension。',
      '只抽取图片里真实出现的分类和百分比，不要推断、补全或编造。',
      'share 必须是 0-1 的小数，例如 46.27% 输出 0.4627。',
      '如果某张图无法识别，跳过该图。',
      '输出格式必须严格为：{"metrics":[{"dimension":"月均消费金额","category":"0-499元","share":0.0436,"share_text":"4.36%"}]}',
    ].join('\n'),
  }];

  images.forEach((image, index) => {
    const dimension = String(image.dimension || '').trim();
    const dataUrl = String(image.data_url || '').trim();
    if (!dimension || !dataUrl.startsWith('data:image/')) {
      return;
    }
    content.push({
      type: 'input_text',
      text: `图片 ${index + 1} 的维度名称：${dimension}`,
    });
    content.push({
      type: 'input_image',
      image_url: dataUrl,
      detail: 'high',
    });
  });

  if (content.length <= 1) return json({ error: '没有可解析的图片 data URL' }, 400, headers);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{ role: 'user', content }],
      temperature: 0,
    }),
  });

  const rawText = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`OpenAI 返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const message = String((result.error as Record<string, unknown> | undefined)?.message || `OpenAI API error ${response.status}`);
    throw new Error(message);
  }

  const outputText = extractResponseText(result);
  const parsed = parseJsonFromText(outputText);
  const metrics = normalizeParsedMetrics(audienceId, parsed);
  return json({ success: true, metrics, raw_count: metrics.length }, 200, headers);
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
  if (action === 'parse_images') return await handleParseImages(body, headers);
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
