import { SB_SERVICE_ROLE_KEY, SB_URL, getSupabaseHeaders } from '../_shared/supabase-client.ts';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

const ALLOWED_STATUSES = new Set(['draft', 'published', 'archived']);
const ALLOWED_REPORT_TYPES = new Set(['daily', 'weekly', 'monthly', 'single']);
const ALLOWED_RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const SAFE_SLUG_RE = /^[a-zA-Z0-9_-]{1,200}$/;
const SAFE_TAG_RE = /^[\u4e00-\u9fffA-Za-z0-9_-]{1,100}$/;

function buildListUrl(req: Request): string {
  const url = new URL(`${SB_URL}/rest/v1/ai_reports`);
  const requestUrl = new URL(req.url);
  const status = requestUrl.searchParams.get('status') || 'published';
  const reportType = requestUrl.searchParams.get('report_type');
  const riskLevel = requestUrl.searchParams.get('risk_level');
  const tag = requestUrl.searchParams.get('tag');
  const limit = Math.min(Math.max(parseInt(requestUrl.searchParams.get('limit') || '20', 10), 1), 100);
  const offset = Math.max(parseInt(requestUrl.searchParams.get('offset') || '0', 10), 0);

  url.searchParams.set(
    'select',
    'id,slug,title,report_type,report_date,start_date,end_date,summary,risk_level,overview_metrics,high_spend_crowds,actions,tags,published_at,created_at'
  );
  url.searchParams.set('order', 'report_date.desc,created_at.desc');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  if (ALLOWED_STATUSES.has(status)) {
    url.searchParams.set('status', `eq.${status}`);
  } else {
    url.searchParams.set('status', 'eq.published');
  }

  if (reportType && ALLOWED_REPORT_TYPES.has(reportType)) {
    url.searchParams.set('report_type', `eq.${reportType}`);
  }
  if (riskLevel && ALLOWED_RISK_LEVELS.has(riskLevel)) {
    url.searchParams.set('risk_level', `eq.${riskLevel}`);
  }
  if (tag && SAFE_TAG_RE.test(tag)) {
    url.searchParams.set('tags', `cs.{${tag}}`);
  }

  return url.toString();
}

function buildDetailUrl(slug: string): string {
  const url = new URL(`${SB_URL}/rest/v1/ai_reports`);
  url.searchParams.set(
    'select',
    'id,slug,title,report_type,report_date,start_date,end_date,status,visibility,summary,risk_level,executive_summary,overview_metrics,highlights,high_spend_crowds,actions,finance_adjustment,live_session_insight,tags,raw_markdown,raw_payload,published_at,created_at,updated_at'
  );
  url.searchParams.set('slug', `eq.${slug}`);
  url.searchParams.set('limit', '1');
  return url.toString();
}

function parseTotalCount(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const total = contentRange.split('/')[1];
  const parsed = total ? parseInt(total, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingAiReportsTable(status: number, errorText: string): boolean {
  return status === 404 && errorText.includes('PGRST205') && errorText.includes('ai_reports');
}

function stripMarkdown(text: string): string {
  return String(text || '')
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

function normalizeReportText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripReportPreamble(text: string): string {
  const normalized = normalizeReportText(text);
  if (!normalized) return '';

  const sectionTitles = ['大盘结论', '高消耗人群分析', '重点人群点名', '财务与退款修正', '明日执行建议'];
  const firstSectionIndex = sectionTitles
    .map((title) => normalized.indexOf(title))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  const startsWithWeakPreamble = /^(好的，我|好的，|首先，我|根据提供的|让我|下面我|我将|我需要)/.test(normalized);
  if (Number.isInteger(firstSectionIndex) && (startsWithWeakPreamble || firstSectionIndex > 0)) {
    return normalized.slice(firstSectionIndex).trim();
  }

  return normalized;
}

function isWeakSummary(text: string): boolean {
  const normalized = stripMarkdown(stripReportPreamble(text));
  if (!normalized) return true;

  return [
    normalized.includes('我需要作为'),
    normalized.includes('我需要根据'),
    normalized.includes('首先，我需要'),
    normalized.includes('虽然说是昨日数据'),
    normalized.includes('暂且理解'),
    normalized.includes('让我思考'),
    normalized.startsWith('好的，我'),
    normalized.startsWith('好的，'),
  ].some(Boolean);
}

function buildSummaryFallback(item: Record<string, unknown>): string {
  const metrics = (item.overview_metrics as Record<string, string> | null) ?? {};
  const riskLevel = String(item.risk_level || '');
  const fragments: string[] = [];

  if (metrics.returnRate) fragments.push(`退货率 ${metrics.returnRate}`);
  if (metrics.returnRoi) fragments.push(`去退 ROI ${metrics.returnRoi}`);
  if (metrics.finMargin) fragments.push(`毛利率 ${metrics.finMargin}`);

  if (riskLevel === 'critical' || riskLevel === 'high') {
    fragments.unshift('当前报告属于高风险，需要优先看真实回报和退款侵蚀');
  }

  if (!fragments.length) {
    return '当前报告已生成，建议重点查看高消耗人群、财务修正与执行动作。';
  }

  return `${fragments.join('，')}。`;
}

function cleanSummary(text: string, item: Record<string, unknown>): string {
  const cleaned = stripMarkdown(stripReportPreamble(text));
  if (!cleaned || isWeakSummary(cleaned)) {
    return buildSummaryFallback(item);
  }
  return cleaned.slice(0, 140);
}

function sanitizeReportItem<T extends Record<string, unknown>>(item: T): T {
  const nextItem = { ...item };

  nextItem.summary = cleanSummary(String(item.summary || ''), nextItem);

  if (item.executive_summary && typeof item.executive_summary === 'object') {
    const executiveSummary = { ...(item.executive_summary as Record<string, unknown>) };
    executiveSummary.headline = cleanSummary(String(executiveSummary.headline || ''), nextItem);
    nextItem.executive_summary = executiveSummary;
  }

  if (typeof item.raw_markdown === 'string') {
    nextItem.raw_markdown = stripReportPreamble(item.raw_markdown);
  }

  if (item.raw_payload && typeof item.raw_payload === 'object') {
    const rawPayload = { ...(item.raw_payload as Record<string, unknown>) };
    if (typeof rawPayload.markdown === 'string') {
      rawPayload.markdown = stripReportPreamble(rawPayload.markdown);
    }
    if (rawPayload.executiveSummary && typeof rawPayload.executiveSummary === 'object') {
      const executiveSummary = { ...(rawPayload.executiveSummary as Record<string, unknown>) };
      executiveSummary.headline = cleanSummary(String(executiveSummary.headline || ''), nextItem);
      rawPayload.executiveSummary = executiveSummary;
    }
    nextItem.raw_payload = rawPayload;
  }

  return nextItem;
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: '仅支持 GET 请求' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  const auth = await authenticateEdgeRequest(req, {
    allowPromptAdmin: true,
    allowSupabaseUser: true,
  });
  if (!auth) {
    return new Response(JSON.stringify({ error: '未登录' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase 环境变量缺失' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  try {
    const requestUrl = new URL(req.url);
    const slug = requestUrl.searchParams.get('slug');

    if (slug) {
      if (!SAFE_SLUG_RE.test(slug)) {
        return new Response(JSON.stringify({ success: false, error: '无效的报告标识' }), {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const response = await fetch(buildDetailUrl(slug), {
        headers: {
          ...getSupabaseHeaders(),
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (isMissingAiReportsTable(response.status, errorText)) {
          return new Response(JSON.stringify({ success: false, error: '报告中心尚未初始化' }), {
            status: 404,
            headers: CORS_HEADERS,
          });
        }
        throw new Error(`查询报告详情失败: ${response.status} ${errorText}`);
      }

      const rows = await response.json();
      const item = Array.isArray(rows) ? rows[0] ?? null : rows;

      if (!item) {
        return new Response(JSON.stringify({ success: false, error: '报告不存在' }), {
          status: 404,
          headers: CORS_HEADERS,
        });
      }

      return new Response(JSON.stringify({ success: true, item: sanitizeReportItem(item) }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    const listUrl = buildListUrl(req);
    const response = await fetch(listUrl, {
      headers: {
        ...getSupabaseHeaders(),
        Prefer: 'count=exact',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (isMissingAiReportsTable(response.status, errorText)) {
        const requestParams = new URL(req.url).searchParams;
        const limit = parseInt(requestParams.get('limit') || '20', 10);
        const offset = parseInt(requestParams.get('offset') || '0', 10);

        return new Response(
          JSON.stringify({
            success: true,
            items: [],
            pagination: {
              limit,
              offset,
              total: 0,
            },
            warning: '报告中心数据表尚未初始化，当前返回空列表。',
          }),
          {
            status: 200,
            headers: CORS_HEADERS,
          }
        );
      }
      throw new Error(`查询报告列表失败: ${response.status} ${errorText}`);
    }

    const items = (await response.json()).map((item: Record<string, unknown>) => sanitizeReportItem(item));
    const requestParams = new URL(req.url).searchParams;
    const limit = parseInt(requestParams.get('limit') || '20', 10);
    const offset = parseInt(requestParams.get('offset') || '0', 10);
    const total = parseTotalCount(response.headers.get('content-range'));

    return new Response(
      JSON.stringify({
        success: true,
        items,
        pagination: {
          limit,
          offset,
          total,
        },
      }),
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (error) {
    console.error('[ai-reports] error:', error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ success: false, error: '查询报告失败，请稍后重试' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
