import {
  getDashboardPayload as getSharedDashboardPayload,
  isValidDateString,
  type RequestedSections,
} from '../_shared/dashboard-payload.ts';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';

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

function parseRequestedSections(value: string | null): RequestedSections {
  if (!value) {
    return { ads: true, crowd: true, single: false };
  }

  const parts = new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

  if (parts.has('all')) {
    return { ads: true, crowd: true, single: true };
  }

  const sections = {
    ads: parts.has('ads'),
    crowd: parts.has('crowd'),
    single: parts.has('single'),
  };

  if (!sections.ads && !sections.crowd && !sections.single) {
    return { ads: true, crowd: true, single: false };
  }

  return sections;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: '仅支持 GET 请求' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const authResult = await authenticateEdgeRequest(req, {
      allowPromptAdmin: true,
      allowSupabaseUser: true,
    });
    if (!authResult) {
      return new Response(JSON.stringify({ error: '未登录' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'Supabase 环境变量缺失' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const requestUrl = new URL(req.url);
    const startDate = requestUrl.searchParams.get('start_date');
    const endDate = requestUrl.searchParams.get('end_date');
    const sections = parseRequestedSections(requestUrl.searchParams.get('sections'));

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: '缺少 start_date 或 end_date' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
      return new Response(JSON.stringify({ error: '日期格式错误，请使用 YYYY-MM-DD' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (startDate > endDate) {
      return new Response(JSON.stringify({ error: 'start_date 不能大于 end_date' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const payload = await getSharedDashboardPayload(startDate, endDate, sections);
    return new Response(JSON.stringify({ success: true, ...payload }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('[dashboard-data] error:', error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ success: false, error: '数据看板查询失败，请稍后重试' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
