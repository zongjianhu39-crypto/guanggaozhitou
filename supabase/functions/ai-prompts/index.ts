// Deno-compatible Supabase Edge Function for prompts
// Supports: GET /latest?key=... and GET /preview?key=...&vars={}

const PROD_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://www.friends.wang';
function getCorsHeaders(req) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : PROD_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

async function loadPrompts() {
  const url = new URL('../../data/prompts.json', import.meta.url);
  const txt = await Deno.readTextFile(url);
  return JSON.parse(txt);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderPreview(content, vars) {
  let rendered = String(content || '');
  Object.keys(vars || {}).forEach((k) => {
    const re = new RegExp('{{\\s*' + escapeRegExp(k) + '\\s*}}', 'g');
    rendered = rendered.replace(re, String(vars[k]));
  });
  return rendered;
}

const EXPECTED_APIKEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

Deno.serve(async (req) => {
  const CORS_HEADERS = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: '仅支持 GET' }), { status: 405, headers: CORS_HEADERS });

  const apikey = req.headers.get('apikey') ?? '';
  if (!EXPECTED_APIKEY || apikey !== EXPECTED_APIKEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) return new Response(JSON.stringify({ error: 'missing_key' }), { status: 400, headers: CORS_HEADERS });

    const data = await loadPrompts();
    const tpl = data[key];
    if (!tpl) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: CORS_HEADERS });

    if (url.pathname.includes('preview')) {
      const varsParam = url.searchParams.get('vars') || '{}';
      let vars = {};
      try { vars = JSON.parse(varsParam); } catch { vars = {}; }
      const preview = renderPreview(tpl.published_version?.content || '', vars);
      return new Response(JSON.stringify({ success: true, preview }), { status: 200, headers: CORS_HEADERS });
    }

    // default: latest
    return new Response(JSON.stringify({ success: true, template: tpl.published_version }), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    console.error('[ai-prompts] error:', err && err.message || err);
    return new Response(JSON.stringify({ error: 'Prompt 查询失败，请稍后重试' }), { status: 500, headers: CORS_HEADERS });
  }
});
