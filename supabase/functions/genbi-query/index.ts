import { getGenbiSemanticConfig } from '../_shared/genbi-semantic.ts';
import { SB_SERVICE_ROLE_KEY, SB_URL } from '../_shared/supabase-client.ts';
import { detectDateRange } from '../_shared/genbi-time.ts';
import { detectIntent, type GenbiIntent } from '../_shared/genbi-intent.ts';
import { buildGenbiRagContext } from '../_shared/genbi-rag.ts';
import { dispatchGenbiIntent } from '../genbi-rules/registry.ts';
import { authenticateEdgeRequest } from '../_shared/request-auth.ts';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-prompt-admin-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

async function handleIntent(question: string) {
  const semantic = await getGenbiSemanticConfig();
  const intent: GenbiIntent = detectIntent(question);
  const range = detectDateRange(question);
  const result = await dispatchGenbiIntent(intent, {
    question,
    range,
    semanticVersion: semantic.version,
  });
  const ragContext = await buildGenbiRagContext(intent, question, range);
  return {
    ...result,
    references: ragContext.references,
    notes: [...(Array.isArray((result as Record<string, unknown>).notes) ? ((result as Record<string, unknown>).notes as string[]) : []), ...ragContext.notes],
  };
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: '仅支持 POST 请求' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  const authResult = await authenticateEdgeRequest(req, {
    allowPromptAdmin: true,
    allowSupabaseUser: true,
  });
  if (!authResult) {
    return new Response(JSON.stringify({ success: false, error: '未登录' }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: 'Supabase 环境变量缺失' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = await req.json();
    const question = String(body?.question || '').trim();
    if (!question) {
      return new Response(JSON.stringify({ success: false, error: '缺少 question' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const response = await handleIntent(question);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error('[genbi-query] error:', error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ success: false, error: 'GenBI 查询失败，请稍后重试' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
