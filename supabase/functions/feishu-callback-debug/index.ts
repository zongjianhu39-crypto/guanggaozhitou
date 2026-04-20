// Supabase Edge Function: feishu-callback-debug
// 用途：接收前端发来的飞书回调调试信息并记录到函数日志，供开发排查
// 安全：仅在 DEBUG_ENABLED=true 时接受请求；需要 apikey header 匹配 anon key

const DEBUG_ENABLED = Deno.env.get('DEBUG_ENABLED') === 'true';
const EXPECTED_APIKEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req: Request) => {
  const CORS_HEADERS = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (!DEBUG_ENABLED) {
    return new Response(JSON.stringify({ error: 'debug endpoint is disabled' }), { status: 403, headers: CORS_HEADERS });
  }

  const apikey = req.headers.get('apikey') ?? '';
  if (!EXPECTED_APIKEY || apikey !== EXPECTED_APIKEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sanitized = { event: String(body?.event || ''), timestamp: body?.timestamp, context: String(body?.context || '').slice(0, 500) };
    console.log('[feishu-callback-debug] debug payload:', JSON.stringify(sanitized));

    return new Response(JSON.stringify({ success: true, recorded: true }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'invalid request' }), { status: 400, headers: CORS_HEADERS });
  }
});
